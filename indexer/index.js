"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const aws_sdk_1 = __importDefault(require("aws-sdk"));
const mime_1 = __importDefault(require("mime"));
const js_yaml_1 = __importDefault(require("js-yaml"));
const lodash_1 = __importDefault(require("lodash"));
const bluebird_1 = __importDefault(require("bluebird"));
const bucketName = process.env.ORIGINAL_BUCKET || "";
const bucketName2 = process.env.INDEX_BUCKET || "";
const distributionDomain = process.env.CLOUDFRONT_DISTRIBUTION_DOMAIN || "";
const s3 = new aws_sdk_1.default.S3();
const cloudfront = new aws_sdk_1.default.CloudFront();
const indexMap = {};
const yamlMap = {};
const isImage = (type) => lodash_1.default.startsWith(type, 'image');
const isVideo = (type) => lodash_1.default.startsWith(type, 'video');
const isFile = (item) => lodash_1.default.get(item, '1.File', false);
const mkPath = (path) => lodash_1.default.join(lodash_1.default.filter(path), "/");
const getAlbumMetadata = (path) => {
    let ok = null;
    if (lodash_1.default.has(yamlMap, path)) {
        ok = bluebird_1.default.resolve(lodash_1.default.get(yamlMap, path));
    }
    else {
        ok = new bluebird_1.default(resolve => {
            s3.getObject({
                Bucket: bucketName,
                Key: path + "/metadata.yml",
            }, (err, data) => {
                try {
                    // ignore if missing
                    if (err)
                        return resolve({});
                    const doc = js_yaml_1.default.safeLoad(lodash_1.default.toString(lodash_1.default.get(data, "Body")));
                    yamlMap[path] = doc;
                    return resolve(doc);
                }
                catch (err) {
                    // ignore if error while parsing
                    return resolve({});
                }
            });
        });
    }
    return ok;
};
const makeIndex = (albumPath, indexPath, index) => {
    let ok;
    let metadata;
    // load album metadata
    ok = getAlbumMetadata(albumPath)
        .then(data => {
        metadata = data;
    });
    if (lodash_1.default.has(indexMap, indexPath)) {
        ok = ok.then(() => bluebird_1.default.resolve(lodash_1.default.get(indexMap, indexPath)));
    }
    else {
        ok = ok.then(() => new bluebird_1.default(resolve => {
            s3.getObject({
                Bucket: bucketName2,
                Key: indexPath,
            }, (err1, data) => {
                // console.log('existing index', data);
                if (lodash_1.default.isEmpty(data)) {
                    data = {};
                }
                else {
                    data = lodash_1.default.get(data, 'Body');
                    data = data.toString();
                    data = JSON.parse(data);
                }
                resolve(data);
            });
        }));
    }
    return ok.then((existing) => {
        lodash_1.default.set(index, 'albums', lodash_1.default.unionBy(lodash_1.default.get(existing, 'albums', []), lodash_1.default.get(index, 'albums', []), 'path'));
        lodash_1.default.set(index, 'items', lodash_1.default.unionBy(lodash_1.default.get(existing, 'items', []), lodash_1.default.get(index, 'items', []), 'path'));
        lodash_1.default.assignIn(index, metadata);
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
        return new bluebird_1.default((resolve, reject) => {
            s3.putObject(options, (err1) => {
                if (err1)
                    reject(err1);
                else
                    resolve();
            });
        });
    });
};
const scanPages = (page, basepath) => {
    const data = lodash_1.default.toPairs(page);
    const folderList = lodash_1.default.fromPairs(lodash_1.default.reject(data, isFile));
    const fileList = lodash_1.default.fromPairs(lodash_1.default.filter(data, isFile));
    // console.log('scanning', {basepath, folderList, fileList})
    const originalPath = mkPath(["pics/original", basepath]);
    const relativePath = mkPath(["pics/index", basepath, "index.json"]);
    const index = {
        path: originalPath,
        thumb: mkPath(["pics/resized/360x225", basepath]),
        full: mkPath(["pics/resized/1200x750", basepath]),
        title: basepath,
        albums: lodash_1.default.map(folderList, (data, key) => {
            return {
                path: mkPath(["pics/resized/360x225", basepath, key]),
                title: key,
                thumb: lodash_1.default.first(lodash_1.default.first(lodash_1.default.toPairs(data))),
                index: mkPath(["pics/index", basepath, key, "index.json"]),
            };
        }),
        items: lodash_1.default.map(fileList, (data, key) => {
            return {
                path: mkPath([originalPath, key]),
                type: lodash_1.default.get(data, 'Type'),
            };
        }),
    };
    // console.log('index', originalPath, relativePath, index);
    return makeIndex(originalPath, relativePath, index)
        .then(() => bluebird_1.default.map(lodash_1.default.keys(folderList), (dirname) => {
        return scanPages(lodash_1.default.get(folderList, dirname), mkPath([basepath, dirname]));
    }));
};
const processPage = (page) => {
    // add relevant attributes
    lodash_1.default.each(page, (item) => {
        const key = lodash_1.default.replace(lodash_1.default.get(item, 'Key', ''), 'pics/original/', '');
        item.Type = mime_1.default.getType(lodash_1.default.get(item, 'Key'));
        item.Path = lodash_1.default.split(key, '/');
        // !_.isNull(item.Type) && (item.Path = _.initial(item.Path))
        item.Valid = isImage(item.Type) || isVideo(item.Type);
        item.File = !lodash_1.default.isNull(item.Type);
    });
    // keep Valid only
    page = lodash_1.default.filter(page, 'Valid');
    // map each file to the relative album/folder
    const mmap = {};
    lodash_1.default.each(page, (item) => lodash_1.default.setWith(mmap, item.Path, item, Object));
    // console.log("processing page", JSON.stringify(mmap, null, '\t'));
    return scanPages(mmap);
};
// list all the bucket objects
const processBucket = () => {
    let result = [];
    // cycle over each result page
    const cycle = (token) => {
        return new Promise((resolve, reject) => {
            // List all bucket objects
            s3.listObjectsV2({
                Bucket: bucketName,
                ContinuationToken: token,
                MaxKeys: 100,
            }, (err, data) => {
                // Handle error
                if (err) {
                    console.log("listObjectsV2 error", err, err.stack);
                    return reject(err);
                }
                const page = lodash_1.default.get(data, "Contents", []);
                if (page) {
                    result = lodash_1.default.concat(result, page);
                }
                // continue to the next page
                const newToken = lodash_1.default.get(data, "NextContinuationToken");
                console.log('process page');
                processPage(page)
                    .then(() => resolve(newToken));
            });
        }).then((newToken) => {
            if (newToken)
                return cycle(newToken);
        });
    };
    return cycle().then(() => result);
};
const emptyBucket = () => {
    // cycle over each result page
    const cycle = (token) => {
        return new Promise((resolve, reject) => {
            // List all bucket objects
            s3.listObjectsV2({
                Bucket: bucketName2,
                ContinuationToken: token,
                MaxKeys: 100,
            }, (err, data) => {
                // Handle error
                if (err) {
                    console.log("listObjectsV2 error", err, err.stack);
                    return reject(err);
                }
                const objects = lodash_1.default.get(data, "Contents", []);
                const newToken = lodash_1.default.get(data, "NextContinuationToken");
                // console.log('process objects', objects)
                bluebird_1.default.map(objects, (object) => new bluebird_1.default((resolve, reject) => {
                    console.log("deleting", lodash_1.default.get(object, 'Key'));
                    s3.deleteObject({
                        Bucket: bucketName2,
                        Key: lodash_1.default.get(object, 'Key'),
                    }, (err) => {
                        if (err)
                            reject(err);
                        else
                            resolve();
                    });
                }))
                    .then(() => resolve(newToken));
            });
        }).then((newToken) => {
            if (newToken)
                return cycle(newToken);
        });
    };
    return cycle();
};
const invalidateCloudFront = () => new bluebird_1.default((resolve, reject) => {
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
                CallerReference: "index-" + Date.now(),
                Paths: {
                    Items: ["/*"],
                    Quantity: 1,
                },
            },
        }, (err) => {
            if (err)
                reject(err);
            else
                resolve();
        });
    });
});
function handler(event, context) {
    emptyBucket()
        .then(() => processBucket())
        .then(() => invalidateCloudFront())
        .then(() => context && context.succeed())
        .catch(err => context && context.fail(err));
}
exports.handler = handler;
//# sourceMappingURL=index.js.map