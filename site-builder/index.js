"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const aws_sdk_1 = __importDefault(require("aws-sdk"));
const async_1 = __importDefault(require("async"));
const fs_1 = __importDefault(require("fs"));
const mime_1 = __importDefault(require("mime"));
const path_1 = __importDefault(require("path"));
const js_yaml_1 = __importDefault(require("js-yaml"));
const lodash_1 = __importDefault(require("lodash"));
const bucketName = process.env.ORIGINAL_BUCKET || "";
const s3 = new aws_sdk_1.default.S3();
const cloudfront = new aws_sdk_1.default.CloudFront();
const walk = (dir, done) => {
    let results = [];
    fs_1.default.readdir(dir, (err, list) => {
        if (err) {
            return done(err, []);
        }
        let pending = list.length;
        if (!pending) {
            return done(null, results);
        }
        list.forEach((file) => {
            file = path_1.default.resolve(dir, file);
            fs_1.default.stat(file, (err1, stat) => {
                if (stat && stat.isDirectory()) {
                    walk(file, (err2, res) => {
                        if (err2) {
                            return done(err2, []);
                        }
                        results = results.concat(res);
                        if (!--pending) {
                            done(null, results);
                        }
                    });
                }
                else {
                    results.push(file);
                    if (!--pending) {
                        done(null, results);
                    }
                }
            });
        });
    });
};
const stripPrefix = (path1) => lodash_1.default.replace(path1, "pics/original/", "");
const isFile = (path1) => !lodash_1.default.isEmpty(path_1.default.extname(path1));
const folderName = (path1) => isFile(path1) ? path_1.default.dirname(path1) : path1;
const lm = (a) => lodash_1.default.get(a, "LastModified");
const getAlbums = (images) => {
    const result = {};
    //    images = images.sort((a: object, b: object): number => lm(b) - lm(a));
    let image;
    let album;
    lodash_1.default.each(images, (data) => {
        const imagePath = lodash_1.default.get(data, "Key", "");
        image = {
            id: stripPrefix(imagePath),
            mime: mime_1.default.getType(imagePath),
            name: path_1.default.basename(imagePath),
            path: imagePath,
        };
        const albumPath = path_1.default.dirname(imagePath);
        const albumId = stripPrefix(albumPath);
        if (!lodash_1.default.has(result, albumId)) {
            album = {
                id: albumId,
                metadata: null,
                name: path_1.default.basename(albumPath),
                path: albumPath,
                pictures: [],
            };
            result[albumId] = album;
        }
        else {
            album = lodash_1.default.get(result, albumId);
        }
        album.pictures = lodash_1.default.uniqBy(lodash_1.default.concat(album.pictures, [image]), "id");
    });
    return result;
};
const getAlbumMetadata = (album, cb) => {
    s3.getObject({
        Bucket: bucketName,
        Key: album.path + "/metadata.yml",
    }, (err, data) => {
        if (err) {
            // ignore if missing
            cb(null, null);
        }
        else {
            try {
                const doc = js_yaml_1.default.safeLoad(lodash_1.default.toString(lodash_1.default.get(data, "Body")));
                cb(null, doc);
            }
            catch (err) {
                // ignore if error while parsing
                cb(null, null);
            }
        }
    });
};
const uploadHomepageSite = (albums) => {
    const tmplDir = "homepage";
    walk(tmplDir, (err, files) => {
        if (err) {
            throw err;
        }
        async_1.default.map(files, (f, cb) => {
            let body = fs_1.default.readFileSync(f).toString("UTF-8");
            if (path_1.default.basename(f) === "error.html") {
                body = body.replace(/\{website\}/g, process.env.WEBSITE || "");
            }
            else if (path_1.default.basename(f) === "index.html") {
                let picturesHTML = "";
                lodash_1.default.each(albums, (album) => {
                    const albumTitle = lodash_1.default.get(album.metadata, "title", album.name);
                    const thumbnail = lodash_1.default.get(album.pictures, [0, "name"]);
                    picturesHTML += "<article class=\"thumb\">" +
                        "<a href=\"" + album.id + "/index.html\" class=\"image\">" +
                        "<img src=\"/pics/resized/1200x750/" + thumbnail + "\" alt=\"\" /></a>" +
                        "<h2>" + albumTitle + "</h2>" +
                        "</article>";
                });
                body = body
                    .replace(/\{title\}/g, process.env.WEBSITE_TITLE || "")
                    .replace(/\{pictures\}/g, picturesHTML);
            }
            const options = {
                Body: body,
                Bucket: process.env.SITE_BUCKET || "",
                ContentType: mime_1.default.getType(path_1.default.extname(f)) || undefined,
                // ContentType: mime.lookup(path.extname(f))
                Key: path_1.default.relative(tmplDir, f),
            };
            console.log("Uploading file", options.Key);
            s3.putObject(options, cb);
        }, (err1, results) => {
            if (err1) {
                console.log(err1, err1.stack);
            }
        });
    });
};
/*




function uploadAlbumSite (title, pictures, metadata) {
  var dir = 'album'
  walk(dir, function (err, files) {
    if (err) throw err

    async.map(files, function (f, cb) {
      var body = fs.readFileSync(f)

      if (path.basename(f) == 'index.html') {
        // Defaults
        var renderedTitle = title,
          comment1 = ''
        comment2 = ''

        // Metadata
        if (metadata) {
          if (metadata.title) renderedTitle = metadata.title
          if (metadata.comment1) comment1 = metadata.comment1
          if (metadata.comment2) comment2 = metadata.comment2
        }

        // Pictures
        var picturesHTML = ''
        for (var i = pictures.length - 1; i >= 0; i--) {
          picturesHTML += '\t\t\t\t\t\t<article>\n' +
            '\t\t\t\t\t\t\t<a class="thumbnail" href="/pics/resized/1200x750/' + pictures[i] + '" data-position="center"><img class="lazy" src="assets/css/images/placeholder.png" data-original="/pics/resized/360x225/' + pictures[i] + '" width="360" height="225"/></a>\n' +
            '<p><a href="/pics/original/' + pictures[i] + '" download>High Resolution Download</a></p>\n' +
            '\t\t\t\t\t\t</article>'
        }
        body = body.toString().replace(/\{title\}/g, renderedTitle)
          .replace(/\{comment1\}/g, comment1)
          .replace(/\{comment2\}/g, comment2)
          .replace(/\{pictures\}/g, picturesHTML)
      }

      var options = {
        Bucket: process.env.SITE_BUCKET,
        Key: title + '/' + path.relative(dir, f),
        Body: body,
        ContentType: mime.lookup(path.extname(f))
      }

      s3.putObject(options, cb)
    }, function (err, results) {
      if (err) console.log(err, err.stack)
    })
  })
}

function invalidateCloudFront () {
  cloudfront.listDistributions(function (err, data) {
    // Handle error
    if (err) {
      console.log(err, err.stack)
      return
    }

    // Get distribution ID from domain name
    var distributionID = data.Items.find(function (d) {
      return d.DomainName == process.env.CLOUDFRONT_DISTRIBUTION_DOMAIN
    }).Id

    // Create invalidation
    cloudfront.createInvalidation({
      DistributionId: distributionID,
      InvalidationBatch: {
        CallerReference: 'site-builder-' + Date.now(),
        Paths: {
          Quantity: 1,
          Items: [
            '/*'
          ]
        }
      }
    }, function (err, data) {
      if (err) console.log(err, err.stack)
    })
  })
}


*/
/*
// process all the entries for this result page
const processPage = (data: ListObjectsV2Output, result: Dictionary<IAlbum>): NextToken|undefined => {



/*

      // Upload album sites
      for (let i = albumsAndPictures.albums.length - 1; i >= 0; i--) {
          uploadAlbumSite(albumsAndPictures.albums[i], albumsAndPictures.pictures[i], metadata[i]);
      }

      // Invalidate CloudFront
      invalidateCloudFront();


  return data.NextContinuationToken;
};
*/
// list all the bucket objects
const processBucket = () => {
    let result = [];
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
                // console.log("data", data);
                const contents = lodash_1.default.get(data, "Contents", []);
                if (contents) {
                    result = lodash_1.default.concat(result, contents);
                }
                const newToken = lodash_1.default.get(data, "NextContinuationToken");
                if (!newToken) {
                    return resolve();
                }
                cycle(newToken).then(resolve);
            });
        });
    };
    return cycle().then(() => result);
};
// https://docs.aws.amazon.com/lambda/latest/dg/eventsources.html#eventsources-s3-put
function handler(event, context) {
    console.log("event ", JSON.stringify(event));
    /*    async.mapLimit(_.get(event, "Records", []), 4, (record: any, cb: (err: Error|null, result?: any) => void) => {
            const originalKey = decodeURIComponent(
                _.get(record, "s3.object.key", "")
                .replace(/\+/g, " "));
    
            s3.getObject({
                Bucket: record.s3.bucket.name,
                Key: originalKey,
            }, (err1: AWSError, data: any) => {
                if (err1) {
                    cb(err1);
                } else {
                    cb(null, {
                        Key: originalKey,
                        LastModified: data.LastModified,
                        ETag: data.ETag,
                        Size: data.ContentLength,
                        // StorageClass: 'STANDARD',
                    });
                }
            });
        }, (err?: Error|null, result?: any[]) => {
            if (err) {
                console.log("error", err, err.stack);
            }
    */
    const result = [];
    let ok;
    if (!lodash_1.default.size(result)) {
        ok = processBucket();
    }
    else {
        ok = Promise.resolve(result);
    }
    ok.then((images) => {
        images = lodash_1.default.filter(images);
        console.log("images", images);
        const albums = getAlbums(images);
        console.log("albums", JSON.stringify(albums));
        async_1.default.mapLimit(albums, 4, (album, cb) => {
            getAlbumMetadata(album, (err1, metadata) => {
                if (metadata) {
                    // console.log("album", album, "metadata", metadata);
                    album.metadata = metadata;
                }
                cb(null, album);
            });
        }, (err1, result1) => {
            // Upload homepage site
            uploadHomepageSite(albums);
            context && context.succeed();
        });
    });
    //    });
}
exports.handler = handler;
//# sourceMappingURL=index.js.map