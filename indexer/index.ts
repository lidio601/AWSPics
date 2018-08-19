import path from "path";
import AWS, {AWSError} from "aws-sdk";
import {default as mime} from "mime";
import yaml from "js-yaml";
import {GetObjectOutput, ListObjectsV2Output, NextToken} from "aws-sdk/clients/s3";
import _ from "lodash";
import Bluebird from "bluebird";

const bucketName = process.env.ORIGINAL_BUCKET || "";
const bucketName2 = process.env.INDEX_BUCKET || "";
const distributionDomain = process.env.CLOUDFRONT_DISTRIBUTION_DOMAIN || "";

const s3 = new AWS.S3();
const cloudfront = new AWS.CloudFront();

const indexMap: object = {};
const yamlMap: object = {};

const isImage = (type: string): boolean => _.startsWith(type, 'image');
const isVideo = (type: string): boolean => _.startsWith(type, 'video');
const isFile  = (item: object): boolean => _.get(item, '1.File', false);
const mkPath  = (path: (string|undefined)[]): string => _.join(_.filter(path), "/")

const getAlbumMetadata = (path: string): Bluebird<any> => {
    let ok: Bluebird<any>|null = null;

    if (_.has(yamlMap, path)) {
        ok = Bluebird.resolve(_.get(yamlMap, path));
    } else {
        ok = new Bluebird(resolve => {
            s3.getObject({
                Bucket: bucketName,
                Key: path + "/metadata.yml",
            }, (err: AWSError, data: GetObjectOutput): void => {
                try {
                    // ignore if missing
                    if (err)    return resolve({});

                    const doc: any = yaml.safeLoad(_.toString(_.get(data, "Body")));
                    yamlMap[path] = doc

                    return resolve(doc)
                } catch (err) {
                    // ignore if error while parsing
                    return resolve({})
                }
            });
        });
    }

    return ok;
};

const makeIndex = (albumPath: string, indexPath: string, index: object): Bluebird<any> => {
    let ok: Bluebird<any>;
    let metadata: object;

    // load album metadata
    ok = getAlbumMetadata(albumPath)
        .then(data => {
            metadata = data
        });

    if (_.has(indexMap, indexPath)) {
        ok = ok.then(() => Bluebird.resolve(_.get(indexMap, indexPath)));
    } else {
        ok = ok.then(() => new Bluebird(resolve => {
            s3.getObject({
                Bucket: bucketName2,
                Key: indexPath,
            }, (err1: AWSError, data: any) => {
                // console.log('existing index', data);
                if (_.isEmpty(data)) {
                    data = {}
                } else {
                    data = _.get(data, 'Body')
                    data = data.toString()
                    data = JSON.parse(data)
                }

                resolve(data)
            });
        }));
    }

    return ok.then((existing: object) => {
        _.set(index, 'albums', _.unionBy(
            _.get(existing, 'albums', []),
            _.get(index, 'albums', []),
            'path'
        ))
        _.set(index, 'items', _.unionBy(
            _.get(existing, 'items', []),
            _.get(index, 'items', []),
            'path'
        ))
        _.assignIn(index, metadata)
        indexMap[indexPath] = index;
        // console.log('output index', index);

        const options = {
            Body: JSON.stringify(index, null, "\t"),
            Bucket: bucketName2,
            ContentType: "application/json",
            // ContentType: mime.lookup(path.extname(f))
            Key: indexPath,
        };

        console.log("Uploading index file", options.Key);
        return new Bluebird((resolve, reject) => {
            s3.putObject(options, (err1: AWSError) => {
                if (err1) reject(err1)
                else resolve()
            })
        })
    })
};

const scanPages = (page: object, basepath?: string): Bluebird<any> => {
    const data: object = _.toPairs(page)
    const folderList: object = _.fromPairs(_.reject(data, isFile))
    const fileList: object = _.fromPairs(_.filter(data, isFile))
    // console.log('scanning', {basepath, folderList, fileList})

    const originalPath = mkPath(["pics/original", basepath])
    const relativePath = mkPath(["pics/index", basepath, "index.json"])
    const index = {
        path: originalPath,
        thumb: mkPath(["pics/resized/360x225", basepath]),
        full: mkPath(["pics/resized/1200x750", basepath]),
        title: basepath,
        albums: _.map(folderList, (data: object, key: string) => {
            return {
                path: mkPath(["pics/resized/360x225", basepath, key]),
                title: key,
                thumb: _.first(_.first(_.toPairs(data))),
                index: mkPath(["pics/index", basepath, key, "index.json"]),
            }
        }),
        items: _.map(fileList, (data: object, key: string) => {
            return {
                path: mkPath([originalPath, key]),
                type: _.get(data, 'Type'),
            }
        }),
    };

    // console.log('index', originalPath, relativePath, index);
    return makeIndex(originalPath, relativePath, index)
        .then(() =>
            Bluebird.map(_.keys(folderList), (dirname: string) => {
                return scanPages(
                    _.get(folderList, dirname),
                    mkPath([basepath, dirname])
                );
            }))
};

const processPage = (page: object[]): Bluebird<any> => {
    // add relevant attributes
    _.each(page, (item: any) => {
        const key = _.replace(_.get(item, 'Key', ''), 'pics/original/', '')
        item.Type = mime.getType(_.get(item, 'Key'))
        item.Path = _.split(key, '/')
        // !_.isNull(item.Type) && (item.Path = _.initial(item.Path))
        item.Valid = isImage(item.Type) || isVideo(item.Type)
        item.File = !_.isNull(item.Type)
    })

    // keep Valid only
    page = _.filter(page, 'Valid')

    // map each file to the relative album/folder
    const mmap: object = {}
    _.each(page, (item: any) => _.setWith(mmap, item.Path, item, Object))

    // console.log("processing page", JSON.stringify(mmap, null, '\t'));
    return scanPages(mmap)
};

// list all the bucket objects
const processBucket = (): Promise<object[]> => {
    let result: object[] = [];

    // cycle over each result page
    const cycle = (token?: NextToken): Promise<void> => {
        return new Promise<NextToken|undefined>((resolve, reject) => {
            // List all bucket objects
            s3.listObjectsV2({
                Bucket: bucketName,
                ContinuationToken: token,
                MaxKeys: 100,
            }, (err: AWSError, data: ListObjectsV2Output): void => {
                // Handle error
                if (err) {
                    console.log("listObjectsV2 error", err, err.stack);
                    return reject(err);
                }

                const page: any = _.get(data, "Contents", []);
                if (page) {
                    result = _.concat(result, page);
                }

                // continue to the next page
                const newToken: NextToken|undefined = _.get(data, "NextContinuationToken");

                console.log('process page')
                processPage(page)
                    .then(() => resolve(newToken))
            })
        }).then((newToken: NextToken|undefined) => {
            if (newToken) return cycle(newToken);
            else console.log('processBucket ended');
        })
    };

    console.log('processBucket started');
    return cycle().then(() => result);
};

const emptyBucket = () : Promise<void> => {
    // cycle over each result page
    const cycle = (token?: NextToken): Promise<void> => {
        return new Promise<NextToken|undefined>((resolve, reject) => {
            // List all bucket objects
            s3.listObjectsV2({
                Bucket: bucketName2,
                ContinuationToken: token,
                MaxKeys: 100,
            }, (err: AWSError, data: ListObjectsV2Output): void => {
                // Handle error
                if (err) {
                    console.log("listObjectsV2 error", err, err.stack);
                    return reject(err);
                }

                const objects: any = _.get(data, "Contents", []);
                const newToken: NextToken|undefined = _.get(data, "NextContinuationToken");

                // console.log('process objects', objects)
                Bluebird.map(objects, (object: object) =>
                    new Bluebird((resolve, reject) => {
                        console.log("deleting", _.get(object, 'Key'));
                        s3.deleteObject({
                            Bucket: bucketName2,
                            Key: _.get(object, 'Key'),
                        }, (err: AWSError) => {
                            if (err)  reject(err)
                            else  resolve()
                        })
                    }))
                    .then(() => resolve(newToken))
            })
        }).then((newToken: NextToken|undefined) => {
            if (newToken) return cycle(newToken);
            else console.log('emptyBucket ended');
        })
    };

    console.log('emptyBucket started');
    return cycle();
};

const invalidateCloudFront = (): Bluebird<void> =>
    new Bluebird((resolve, reject) => {
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
                    CallerReference: "index-" + Date.now(),
                    Paths: {
                        Items: ["/*"],
                        Quantity: 1,
                    },
                },
            }, (err: AWSError) => {
                if (err)  reject(err)
                else  resolve()
            })
        })
    });

export function handler(event: any, context: any): void {
    emptyBucket()
        .then(() => processBucket())
        .then(() => invalidateCloudFront())
        .then(() => context && context.succeed())
        .catch(err => context && context.fail(err))
}
