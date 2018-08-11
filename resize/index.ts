import AWS, {AWSError} from "aws-sdk";
import async from "async";
import gm from "gm";
import {default as mime} from "mime";
import _ from "lodash";
import path from "path";

const PIPELINE_ID = process.env.PIPELINE_ID || "";
const PRESET360_ID = process.env.PRESET360_ID || "";
const PRESET1200_ID = process.env.PRESET1200_ID || "";
const distributionDomain = process.env.CLOUDFRONT_DISTRIBUTION_DOMAIN || "";
const bucketName = process.env.RESIZED_BUCKET || "";
const im = gm.subClass({
    imageMagick: true,
});
const s3 = new AWS.S3();
const cloudfront = new AWS.CloudFront();
const sizes = ["1200x750", "360x225"];
const elastictranscoder = new AWS.ElasticTranscoder({apiVersion: '2012-09-25'});

const getImageType = (objectContentType): string => {
    const res: string | null = mime.getExtension(objectContentType);
    if (!_.startsWith(objectContentType, "image")) {
        console.log("unsupported objectContentType " + objectContentType);
        return "";
    }

    return res || "";
};

const getVideoType = (objectContentType: string): string => {
    const res: string | null = mime.getExtension(objectContentType);
    if (!_.startsWith(objectContentType, "video")) {
        console.log("unsupported objectContentType " + objectContentType);
        return "";
    }

    return res || "";
};

const cross = (left, right): any[] => {
    const res: any = [];

    left.forEach((l: any) => {
        right.forEach((r: any) => {
            res.push([l, r]);
        });
    });

    return res;
};

function invalidateCloudFront(cb: (err: Error|null) => void) {
    cloudfront.listDistributions((err: AWSError, data: any) => {
        // Handle error
        if (err) {
            console.log(err, err.stack)
            return;
        }

        // Get distribution ID from domain name
        const distributionID = data.Items.find((d: any) => {
            return d.DomainName === distributionDomain
        }).Id

        // Create invalidation
        console.log("Cloudfront invalidating /*")
        cloudfront.createInvalidation({
            DistributionId: distributionID,
            InvalidationBatch: {
                CallerReference: "resize-" + Date.now(),
                Paths: {
                    Items: ["/*"],
                    Quantity: 1,
                },
            },
        }, (err: AWSError) => {
            if (err) console.log(err, err.stack);
            cb(err);
        })
    })
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
function handlePutEvent(records: object[], cb: (err1?: Error|null) => void): void {
    // retrieve all the matching images
    async.mapLimit(records, 4, (record: any, cb: (err: Error|null, result?: any) => void): void => {
        const originalKey = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
        s3.getObject({
            Bucket: record.s3.bucket.name,
            Key: originalKey,
        }, (err: AWSError, data: any) => {
            if (err) {
                cb(null, {} /*err*/);
            } else {
                const imageType = getImageType(data.ContentType);
                const videoType = getVideoType(data.ContentType);
                if (_.isEmpty(imageType) && _.isEmpty(videoType)) cb(null)
                else cb(null, {
                    buffer: data.Body,
                    contentType: data.ContentType,
                    imageType,
                    videoType,
                    originalKey,
                    record,
                });
            }
        });
    }, (err?: Error|null, images?: string[]) => {
        console.log("images", images);
        images = _.filter(images, im => !_.isEmpty(im));
        if (err) {
            cb(err);
        } else if (!_.size(images)) {
            cb();
        } else {
            const resizePairs = cross(sizes, images);
            async.eachLimit(resizePairs, 4, (resizePair: any[], cb: (err: Error | null, result?: any) => void) => {
                console.log("processing image", resizePair);
                const config = resizePair[0]
                const image = resizePair[1]
                const relativePath = image.originalKey.replace("pics/original/", "")
                const width = config.split("x")[0]
                const height = config.split("x")[1]

                // produce video thumbnail
                if (!_.isEmpty(image.videoType)) {
                    const resizePath = "pics/resized/" + config + "/" + relativePath.replace(path.extname(relativePath), ".gif")
                    const presetId = parseInt(width) === 360 ? PRESET360_ID : PRESET1200_ID;

                    if (_.isEmpty(presetId)) {
                        return cb(null);
                    }

                    console.log("creating elastictranscoder job", resizePath)
                    s3.deleteObject({
                        Bucket: bucketName,
                        Key: resizePath,
                    }, () => {
                        elastictranscoder.createJob({
                            Input: {
                                Key: image.originalKey,
                                FrameRate: "10",
                                TimeSpan: {
                                    Duration: "5", // take only the first 5 sec
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
                else if (!_.isEmpty(image.imageType)) {
                    const resizePath = "pics/resized/" + config + "/" + relativePath
                    let operation = im(image.buffer).resize(width, height, "^")

                    if (config === "360x225") {
                        operation = operation.gravity("Center").crop(width, height);
                    }

                    operation.toBuffer(image.imageType, (err3: Error | null, buffer: any) => {
                        if (err3) cb(err3);
                        else {
                            console.log("putting resize image", resizePath)
                            s3.putObject({
                                Body: buffer,
                                Bucket: bucketName,
                                ContentType: image.contentType,
                                Key: resizePath,
                            }, cb);
                        }
                    });
                } else {
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
function handleDeleteEvent(records: object[], cb: (err1?: Error|null) => void): void {
    // retrieve all the matching images
    async.mapLimit(records, 4, (record: any, cb: (err: Error|null) => void): void => {
        const originalKey = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
        const relativePath = originalKey.replace("pics/original/", "")
        const resizePairs = cross(sizes, [originalKey]);

        async.eachLimit(resizePairs, 4, (resizePair: any[], cb: (err: Error|null, result?: any) => void) => {
            const config = resizePair[0]
            const resizePath = "pics/resized/" + config + "/" + relativePath
            const resizePath2 = "pics/resized/" + config + "/" + relativePath.replace(path.extname(relativePath), ".gif")

            console.log("deleting resized image", resizePath)
            s3.deleteObject({
                Bucket: bucketName,
                Key: resizePath,
            }, () => {
                console.log("deleting resized image", resizePath2)
                s3.deleteObject({
                    Bucket: bucketName,
                    Key: resizePath2,
                }, cb);
            });
        })
    }, cb);
}

export function handler(event: any, context: any): void {
    console.log("event ", JSON.stringify(event));

    const records = event.Records || [];
    const putRecords = _.filter(records, r => _.isEqual(_.get(r, "eventName"), "ObjectCreated:Put"))
    const deleteRecords = _.filter(records, r => _.isEqual(_.get(r, "eventName"), "ObjectRemoved:Delete"))
    console.log("got", _.size(putRecords), "records on put");
    console.log("got", _.size(deleteRecords), "records on delete");

    handlePutEvent(putRecords, (err?: Error|null) => {
        if (err) context.fail(err);
        else {
            handleDeleteEvent(deleteRecords, (err?: Error | null) => {
                if (err) context.fail(err);
                else invalidateCloudFront((err3: Error|null) => {
                    if (err3) context.fail(err);
                    else context.succeed()
                });
            })
        }
    });
}
