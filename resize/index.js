"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const aws_sdk_1 = __importDefault(require("aws-sdk"));
const async_1 = __importDefault(require("async"));
const gm_1 = __importDefault(require("gm"));
const mime_1 = __importDefault(require("mime"));
const lodash_1 = __importDefault(require("lodash"));
const path_1 = __importDefault(require("path"));
const PIPELINE_ID = process.env.PIPELINE_ID || "";
const PRESET360_ID = process.env.PRESET360_ID || "";
const PRESET1200_ID = process.env.PRESET1200_ID || "";
const distributionDomain = process.env.CLOUDFRONT_DISTRIBUTION_DOMAIN || "";
const bucketName = process.env.RESIZED_BUCKET || "";
const im = gm_1.default.subClass({
    imageMagick: true,
});
const s3 = new aws_sdk_1.default.S3();
const cloudfront = new aws_sdk_1.default.CloudFront();
const sizes = ["1200x750", "360x225"];
const elastictranscoder = new aws_sdk_1.default.ElasticTranscoder({ apiVersion: '2012-09-25' });
const getImageType = (objectContentType) => {
    const res = mime_1.default.getExtension(objectContentType);
    if (!lodash_1.default.startsWith(objectContentType, "image")) {
        console.log("unsupported objectContentType " + objectContentType);
        return "";
    }
    return res || "";
};
const getVideoType = (objectContentType) => {
    const res = mime_1.default.getExtension(objectContentType);
    if (!lodash_1.default.startsWith(objectContentType, "video")) {
        console.log("unsupported objectContentType " + objectContentType);
        return "";
    }
    return res || "";
};
const cross = (left, right) => {
    const res = [];
    left.forEach((l) => {
        right.forEach((r) => {
            res.push([l, r]);
        });
    });
    return res;
};
function invalidateCloudFront(cb) {
    cloudfront.listDistributions((err, data) => {
        // Handle error
        if (err) {
            console.log(err, err.stack);
            return;
        }
        // Get distribution ID from domain name
        const distributionID = data.Items.find((d) => {
            return d.DomainName === distributionDomain;
        }).Id;
        // Create invalidation
        console.log("Cloudfront invalidating /*");
        cloudfront.createInvalidation({
            DistributionId: distributionID,
            InvalidationBatch: {
                CallerReference: "resize-" + Date.now(),
                Paths: {
                    Items: ["/*"],
                    Quantity: 1,
                },
            },
        }, (err) => {
            if (err)
                console.log(err, err.stack);
            cb(err);
        });
    });
}
/*
 * Sample event put
{
  "Records": [
    {
      "s3": {
        "object": {
          "key": "HappyFace.jpg",
          ...
        },
        "bucket": {
          "arn": bucketarn,
          "name": "sourcebucket",
          ...
        },
      },
      ...
      "eventName": "ObjectCreated:Put",
      "eventSource": "aws:s3"
    }
  ]
}
*/
function handlePutEvent(records, cb) {
    // retrieve all the matching images
    async_1.default.mapLimit(records, 4, (record, cb) => {
        const originalKey = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
        s3.getObject({
            Bucket: record.s3.bucket.name,
            Key: originalKey,
        }, (err, data) => {
            if (err) {
                cb(null, {} /*err*/);
            }
            else {
                const imageType = getImageType(data.ContentType);
                const videoType = getVideoType(data.ContentType);
                if (lodash_1.default.isEmpty(imageType) && lodash_1.default.isEmpty(videoType))
                    cb(null);
                else
                    cb(null, {
                        buffer: data.Body,
                        contentType: data.ContentType,
                        imageType,
                        videoType,
                        originalKey,
                        record,
                    });
            }
        });
    }, (err, images) => {
        console.log("images", images);
        images = lodash_1.default.filter(images, im => !lodash_1.default.isEmpty(im));
        if (err) {
            cb(err);
        }
        else if (!lodash_1.default.size(images)) {
            cb();
        }
        else {
            const resizePairs = cross(sizes, images);
            async_1.default.eachLimit(resizePairs, 4, (resizePair, cb) => {
                console.log("processing image", resizePair);
                const config = resizePair[0];
                const image = resizePair[1];
                const relativePath = image.originalKey.replace("pics/original/", "");
                const width = config.split("x")[0];
                const height = config.split("x")[1];
                // produce video thumbnail
                if (!lodash_1.default.isEmpty(image.videoType)) {
                    const resizePath = "pics/resized/" + config + "/" + relativePath.replace(path_1.default.extname(relativePath), ".gif");
                    const presetId = parseInt(width) === 360 ? PRESET360_ID : PRESET1200_ID;
                    if (lodash_1.default.isEmpty(presetId)) {
                        return cb(null);
                    }
                    console.log("creating elastictranscoder job", resizePath);
                    s3.deleteObject({
                        Bucket: bucketName,
                        Key: resizePath,
                    }, () => {
                        elastictranscoder.createJob({
                            Input: {
                                Key: image.originalKey,
                                FrameRate: "10",
                                TimeSpan: {
                                    Duration: "5",
                                }
                            },
                            Output: {
                                Key: resizePath,
                                PresetId: presetId,
                            },
                            PipelineId: PIPELINE_ID,
                        }, cb);
                    });
                }
                // produce image thumbnails
                else if (!lodash_1.default.isEmpty(image.imageType)) {
                    const resizePath = "pics/resized/" + config + "/" + relativePath;
                    let operation = im(image.buffer).resize(width, height, "^");
                    if (config === "360x225") {
                        operation = operation.gravity("Center").crop(width, height);
                    }
                    operation.toBuffer(image.imageType, (err3, buffer) => {
                        if (err3)
                            cb(err3);
                        else {
                            console.log("putting resize image", resizePath);
                            s3.putObject({
                                Body: buffer,
                                Bucket: bucketName,
                                ContentType: image.contentType,
                                Key: resizePath,
                            }, cb);
                        }
                    });
                }
                else {
                    cb(null);
                }
            }, cb);
        }
    });
}
/*
 * Sample event delete
{
  "Records": [
    {
      ...
      "s3": {
        "object": {
          "key": "HappyFace.jpg"
          ...
        },
        "bucket": {
          "arn": bucketarn,
          "name": "sourcebucket"
          ...
        }
      },
      ...
      "eventName": "ObjectRemoved:Delete",
      "eventSource": "aws:s3"
    }
  ]
}
 */
function handleDeleteEvent(records, cb) {
    // retrieve all the matching images
    async_1.default.mapLimit(records, 4, (record, cb) => {
        const originalKey = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
        const relativePath = originalKey.replace("pics/original/", "");
        const resizePairs = cross(sizes, [originalKey]);
        async_1.default.eachLimit(resizePairs, 4, (resizePair, cb) => {
            const config = resizePair[0];
            const resizePath = "pics/resized/" + config + "/" + relativePath;
            const resizePath2 = "pics/resized/" + config + "/" + relativePath.replace(path_1.default.extname(relativePath), ".gif");
            console.log("deleting resized image", resizePath);
            s3.deleteObject({
                Bucket: bucketName,
                Key: resizePath,
            }, () => {
                console.log("deleting resized image", resizePath2);
                s3.deleteObject({
                    Bucket: bucketName,
                    Key: resizePath2,
                }, cb);
            });
        });
    }, cb);
}
function handler(event, context) {
    console.log("event ", JSON.stringify(event));
    const records = event.Records || [];
    const putRecords = lodash_1.default.filter(records, r => lodash_1.default.isEqual(lodash_1.default.get(r, "eventName"), "ObjectCreated:Put"));
    const deleteRecords = lodash_1.default.filter(records, r => lodash_1.default.isEqual(lodash_1.default.get(r, "eventName"), "ObjectRemoved:Delete"));
    console.log("got", lodash_1.default.size(putRecords), "records on put");
    console.log("got", lodash_1.default.size(deleteRecords), "records on delete");
    handlePutEvent(putRecords, (err) => {
        if (err)
            context.fail(err);
        else {
            handleDeleteEvent(deleteRecords, (err) => {
                if (err)
                    context.fail(err);
                else
                    invalidateCloudFront((err3) => {
                        if (err3)
                            context.fail(err);
                        else
                            context.succeed();
                    });
            });
        }
    });
}
exports.handler = handler;
//# sourceMappingURL=index.js.map