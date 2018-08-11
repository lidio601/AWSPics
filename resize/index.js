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
const distributionDomain = process.env.CLOUDFRONT_DISTRIBUTION_DOMAIN || "";
const bucketName = process.env.RESIZED_BUCKET || "";
const im = gm_1.default.subClass({
    imageMagick: true,
});
const s3 = new aws_sdk_1.default.S3();
const cloudfront = new aws_sdk_1.default.CloudFront();
const getImageType = (objectContentType) => {
    const res = mime_1.default.getExtension(objectContentType);
    if (!lodash_1.default.startsWith(res || "", "image")) {
        throw new Error("unsupported objectContentType " + objectContentType);
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
function invalidateCloudFront(imagePaths, cb) {
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
        cloudfront.createInvalidation({
            DistributionId: distributionID,
            InvalidationBatch: {
                CallerReference: "resize-" + Date.now(),
                Paths: {
                    Items: imagePaths || ["/*"],
                    Quantity: 1,
                },
            },
        }, (err, data) => {
            if (err)
                console.log(err, err.stack);
            cb(err);
        });
    });
}
function handler(event, context) {
    console.log("event ", JSON.stringify(event));
    async_1.default.mapLimit(event.Records, 4, (record, cb) => {
        const originalKey = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
        s3.getObject({
            Bucket: record.s3.bucket.name,
            Key: originalKey,
        }, (err, data) => {
            if (err) {
                cb(err);
            }
            else {
                cb(null, {
                    buffer: data.Body,
                    contentType: data.ContentType,
                    imageType: getImageType(data.ContentType),
                    originalKey,
                    record,
                });
            }
        });
    }, (err, images) => {
        if (err) {
            context.fail(err);
        }
        else {
            const imagePaths = [];
            const resizePairs = cross(["1200x750", "360x225"], images);
            async_1.default.eachLimit(resizePairs, 4, (resizePair, cb) => {
                const config = resizePair[0];
                const image = resizePair[1];
                const relativePath = image.originalKey.replace("pics/original/", "");
                const width = config.split("x")[0];
                const height = config.split("x")[1];
                let operation = im(image.buffer).resize(width, height, "^");
                imagePaths.push(image.originalKey);
                if (config === "360x225") {
                    operation = operation.gravity("Center").crop(width, height);
                }
                operation.toBuffer(image.imageType, (err3, buffer) => {
                    if (err3) {
                        cb(err3);
                    }
                    else {
                        s3.putObject({
                            Body: buffer,
                            Bucket: bucketName,
                            ContentType: image.contentType,
                            Key: "pics/resized/" + config + "/" + relativePath,
                        }, (err2) => {
                            cb(err2);
                            imagePaths.push("pics/resized/" + config + "/" + relativePath);
                        });
                    }
                });
            }, (err1) => {
                if (err1)
                    context.fail(err1);
                else
                    invalidateCloudFront(imagePaths, (err2) => {
                        if (err2)
                            context.fail(err2);
                        else
                            context.succeed();
                    });
            });
        }
    });
}
exports.handler = handler;
//# sourceMappingURL=index.js.map