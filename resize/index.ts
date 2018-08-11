import AWS, {AWSError} from "aws-sdk";
import async from "async";
import gm from "gm";
import {default as mime} from "mime";
import _ from "lodash";

const distributionDomain = process.env.CLOUDFRONT_DISTRIBUTION_DOMAIN || "";
const bucketName = process.env.RESIZED_BUCKET || "";
const im = gm.subClass({
    imageMagick: true,
});
const s3 = new AWS.S3();
const cloudfront = new AWS.CloudFront();

const getImageType = (objectContentType): string => {
    const res: string | null = mime.getExtension(objectContentType);
    if (!_.startsWith(res || "", "image")) {
        throw new Error("unsupported objectContentType " + objectContentType);
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

function invalidateCloudFront(imagePaths: string[], cb: (err: Error|null) => void) {
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
        cloudfront.createInvalidation({
            DistributionId: distributionID,
            InvalidationBatch: {
                CallerReference: "resize-" + Date.now(),
                Paths: {
                    Items: imagePaths || ["/*"],
                    Quantity: 1,
                },
            },
        }, (err: AWSError, data: any) => {
            if (err) console.log(err, err.stack);
            cb(err);
        })
    })
}

export function handler(event: any, context: any): void {
    console.log("event ", JSON.stringify(event));
    async.mapLimit(event.Records, 4, (record: any, cb: (err: Error|null, result?: any) => void): void => {
        const originalKey = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));
        s3.getObject({
            Bucket: record.s3.bucket.name,
            Key: originalKey,
        }, (err: AWSError, data: any) => {
            if (err) {
                cb(err);
            } else {
                cb(null, {
                    buffer: data.Body,
                    contentType: data.ContentType,
                    imageType: getImageType(data.ContentType),
                    originalKey,
                    record,
                });
            }
        });
    }, (err?: Error|null, images?: string[]) => {
        if (err) {
            context.fail(err);
        } else {
            const imagePaths: string[] = []
            const resizePairs = cross(["1200x750", "360x225"], images);
            async.eachLimit(resizePairs, 4, (resizePair: any[], cb: (err: Error|null, result?: any) => void) => {
                const config = resizePair[0]
                const image = resizePair[1]
                const relativePath = image.originalKey.replace("pics/original/", "")
                const width = config.split("x")[0]
                const height = config.split("x")[1]
                let operation = im(image.buffer).resize(width, height, "^")

                imagePaths.push(image.originalKey)

                if (config === "360x225") {
                    operation = operation.gravity("Center").crop(width, height);
                }

                operation.toBuffer(image.imageType, (err3: Error|null, buffer: any) => {
                    if (err3) {
                        cb(err3);
                    } else {
                        s3.putObject({
                            Body: buffer,
                            Bucket: bucketName,
                            ContentType: image.contentType,
                            Key: "pics/resized/" + config + "/" + relativePath,
                        }, (err2: AWSError) => {
                            cb(err2);
                            imagePaths.push("pics/resized/" + config + "/" + relativePath)
                        });
                    }
                });
            }, (err1?: Error|null) => {
                if (err1) context.fail(err1);
                else invalidateCloudFront(imagePaths, (err2: Error|null) => {
                    if (err2) context.fail(err2)
                    else context.succeed();
                })
            });
        }
    });
}
