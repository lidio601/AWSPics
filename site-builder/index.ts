import AWS, {AWSError} from "aws-sdk";
import async, {Dictionary} from "async";
import fs from "fs";
import {default as mime} from "mime";
import path from "path";
import yaml from "js-yaml";
import {GetObjectOutput, ListObjectsV2Output, ListObjectsV2Request, NextToken} from "aws-sdk/clients/s3";
import _ from "lodash";
import {GetObjectResponse} from "aws-sdk/clients/mediastoredata";
import {LambdaOutput} from "aws-sdk/clients/kinesisanalytics";

const bucketName = process.env.ORIGINAL_BUCKET || "";
const s3 = new AWS.S3();
const cloudfront = new AWS.CloudFront();

interface IPicture {
    id: string;
    name: string;
    path: string;
    mime: string|null;
}

interface IAlbum {
    id: string;
    name: string;
    path: string;
    pictures: IPicture[];
    metadata: object|null;
}

const walk = (dir: string, done: (err: Error|null, results: string[]) => void) => {
  let results: string[] = [];
  fs.readdir(dir, (err: Error|null, list: string[]) => {
    if (err) {
      return done(err, []);
    }

    let pending = list.length;
    if (!pending) {
      return done(null, results);
    }

    list.forEach((file: string) => {
      file = path.resolve(dir, file);

      fs.stat(file, (err1: Error|null, stat: any) => {
        if (stat && stat.isDirectory()) {
          walk(file, (err2: Error|null, res: string[]) => {
            if (err2) {
              return done(err2, []);
            }

            results = results.concat(res);
            if (!--pending) {
              done(null, results);
            }
          });
        } else {
          results.push(file);

          if (!--pending) {
            done(null, results);
          }
        }
      });
    });
  });
};

const stripPrefix = (path1: string): string =>
    _.replace(path1, "pics/original/", "");

const isFile = (path1: string): boolean =>
    !_.isEmpty(path.extname(path1));

const folderName = (path1: string): string =>
    isFile(path1) ? path.dirname(path1) : path1;

const lm = (a: object): number =>
    _.get(a, "LastModified");

const getAlbums = (images: object[]): Dictionary<IAlbum> => {
    const result: Dictionary<IAlbum> = {};

//    images = images.sort((a: object, b: object): number => lm(b) - lm(a));

    let image: IPicture;
    let album: IAlbum;
    _.each(images, (data: object): void => {
        const imagePath = _.get(data, "Key", "");

        image = {
            id: stripPrefix(imagePath),
            mime: mime.getType(imagePath),
            name: path.basename(imagePath),
            path: imagePath,
        };

        const albumPath = path.dirname(imagePath);
        const albumId = stripPrefix(albumPath);

        if (!_.has(result, albumId)) {
            album = {
                id: albumId,
                metadata: null,
                name: path.basename(albumPath),
                path: albumPath,
                pictures: [],
            };
            result[albumId] = album;
        } else {
            album = _.get(result, albumId);
        }

        album.pictures = _.uniqBy(_.concat(album.pictures, [image]), "id");
    });

    return result;
};

const getAlbumMetadata = (album: IAlbum, cb: (err: Error|null, doc: any) => void): void => {
    s3.getObject({
        Bucket: bucketName,
        Key: album.path + "/metadata.yml",
    }, (err: AWSError, data: GetObjectOutput): void => {
        if (err) {
            // ignore if missing
            cb(null, null);
        } else {
            try {
                const doc: any = yaml.safeLoad(_.toString(_.get(data, "Body")));
                cb(null, doc);
            } catch (err) {
                // ignore if error while parsing
                cb(null, null);
            }
        }
    });
};

const uploadHomepageSite = (albums: Dictionary<IAlbum>): void => {
    const tmplDir = "homepage";
    walk(tmplDir, (err: Error|null, files: string[]): void => {
        if (err) {
            throw err;
        }

        async.map(files, (f: string, cb: () => void) => {
            let body: string = fs.readFileSync(f).toString("UTF-8");

            if (path.basename(f) === "error.html") {
                body = body.replace(/\{website\}/g, process.env.WEBSITE || "")
            } else if (path.basename(f) === "index.html") {
                let picturesHTML = "";

                _.each(albums, (album: IAlbum): void => {
                    const albumTitle = _.get(album.metadata, "title", album.name);
                    const thumbnail = _.get(album.pictures, [0, "name"]);

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
                ContentType: mime.getType(path.extname(f)) || undefined,
                // ContentType: mime.lookup(path.extname(f))
                Key: path.relative(tmplDir, f),
            };

            console.log("Uploading file", options.Key);
            s3.putObject(options, cb);
        }, (err1: Error|null, results: any) => {
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
const processBucket = (): Promise<object[]> => {
    let result: object[] = [];

    const cycle = (token?: NextToken): Promise<void> => {
        return new Promise((resolve, reject) => {
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
                // console.log("data", data);

                const contents: any = _.get(data, "Contents", []);
                if (contents) {
                    result = _.concat(result, contents);
                }
                const newToken: NextToken|undefined = _.get(data, "NextContinuationToken");

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
export function handler(event: any, context: any): void {
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

        let ok: Promise<object[]>;
        if (!_.size(result)) {
            ok = processBucket();
        } else {
            ok = Promise.resolve(result);
        }

        ok.then((images: object[]): Dictionary<IAlbum> => {
            images = _.filter(images);
            console.log("images", images);

            const albums = getAlbums(images);
            console.log("albums", JSON.stringify(albums));

            async.mapLimit(albums, 4, (album: IAlbum, cb: (err: Error|null, result?: any) => void) => {
                getAlbumMetadata(album, (err1: Error | null, metadata: any): void => {
                    if (metadata) {
                        // console.log("album", album, "metadata", metadata);
                        album.metadata = metadata;
                    }
                    cb(null, album);
                });
            }, (err1?: Error|null, result1?: any[]) => {
                // Upload homepage site
                uploadHomepageSite(albums);

                context && context.succeed();
            });
        });
//    });
}
