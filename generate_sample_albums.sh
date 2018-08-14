#!/usr/bin/env bash -e

#
# Generate sample albums for development
# (under site-builder)
#

DIR=site-builder

numberOfAlbums=2

prevMD5=()
function download_images {
    BASEDIR=$1
    mkdir -vp ${BASEDIR}
    for (( picIndex = 0; picIndex < 6; picIndex++ )); do
        echo "Downloading pic $picIndex for album ${BASEDIR}"
        pic="${picIndex}.jpg"
        curl -sL https://source.unsplash.com/random -o "${BASEDIR}/$pic"
        while [[ " ${prevMD5[@]} " =~ " $(md5sum "${BASEDIR}/$pic" | awk '{print $1}') " ]]; do
          curl -sL https://source.unsplash.com/random -o "${BASEDIR}/$pic"
        done
        prevMD5+=("$(md5sum "${BASEDIR}/$pic" | awk '{print $1}')")
    done
}

download_images ${DIR}/pics/original
download_images ${DIR}/pics/resized/1200x750
download_images ${DIR}/pics/resized/360x225
for (( albumIndex = 0; albumIndex < numberOfAlbums; albumIndex++ )); do
    download_images ${DIR}/pics/original/album${albumIndex}
    download_images ${DIR}/pics/resized/1200x750/album${albumIndex}
    download_images ${DIR}/pics/resized/360x225/album${albumIndex}
done

mkdir -vp ${DIR}/pics/index
echo "{\
    \"path\": \"pics/original\",\
	\"title\": null,\
	\"albums\": [\
		{\
			\"path\": \"pics/resized/1200x750/album0\",\
			\"title\": \"album0\",\
			\"thumb\": \"0.jpg\",
			\"index\": \"pics/index/album0/index.json\"\
		},\
		{\
			\"path\": \"pics/resized/1200x750/album1\",\
			\"title\": \"album1\",\
			\"thumb\": \"0.jpg\",
			\"index\": \"pics/index/album1/index.json\"\
		}\
	],\
	\"items\": [\
		{\
			\"path\": \"pics/resized/360x225/0.jpg\",\
			\"full\": \"pics/resized/1200x750/0.jpg\",\
			\"orig\": \"pics/original/0.jpg\",\
			\"type\": \"image/jpeg\"\
		},\
		{\
			\"path\": \"pics/resized/360x225/1.jpg\",\
			\"full\": \"pics/resized/1200x750/1.jpg\",\
			\"orig\": \"pics/original/1.jpg\",\
			\"type\": \"image/jpeg\"\
		},\
		{\
			\"path\": \"pics/resized/360x225/2.jpg\",\
			\"full\": \"pics/resized/1200x750/2.jpg\",\
			\"orig\": \"pics/original/2.jpg\",\
			\"type\": \"image/jpeg\"\
		},\
		{\
			\"path\": \"pics/resized/360x225/3.jpg\",\
			\"full\": \"pics/resized/1200x750/3.jpg\",\
			\"orig\": \"pics/original/3.jpg\",\
			\"type\": \"image/jpeg\"\
		},\
		{\
			\"path\": \"pics/resized/360x225/4.jpg\",\
			\"full\": \"pics/resized/1200x750/4.jpg\",\
			\"orig\": \"pics/original/4.jpg\",\
			\"type\": \"image/jpeg\"\
		},\
		{\
			\"path\": \"pics/resized/360x225/5.jpg\",\
			\"full\": \"pics/resized/1200x750/5.jpg\",\
			\"orig\": \"pics/original/5.jpg\",\
			\"type\": \"image/jpeg\"\
		}\
	]\
}" > ${DIR}/pics/index/index.json

mkdir -vp ${DIR}/pics/index/album0
echo "{\
    \"path\": \"pics/original/album0\",\
	\"title\": \"album0\",\
	\"albums\": [],\
	\"items\": [\
		{\
			\"path\": \"pics/resized/360x225/album0/0.jpg\",\
			\"full\": \"pics/resized/1200x750/album0/0.jpg\",\
			\"orig\": \"pics/original/album0/0.jpg\",\
			\"type\": \"image/jpeg\"\
		},\
		{\
			\"path\": \"pics/resized/360x225/album0/1.jpg\",\
			\"full\": \"pics/resized/1200x750/album0/1.jpg\",\
			\"orig\": \"pics/original/album0/1.jpg\",\
			\"type\": \"image/jpeg\"\
		},\
		{\
			\"path\": \"pics/resized/360x225/album0/2.jpg\",\
			\"full\": \"pics/resized/1200x750/album0/2.jpg\",\
			\"orig\": \"pics/original/album0/2.jpg\",\
			\"type\": \"image/jpeg\"\
		},\
		{\
			\"path\": \"pics/resized/360x225/album0/3.jpg\",\
			\"full\": \"pics/resized/1200x750/album0/3.jpg\",\
			\"orig\": \"pics/original/album0/3.jpg\",\
			\"type\": \"image/jpeg\"\
		},\
		{\
			\"path\": \"pics/resized/360x225/album0/4.jpg\",\
			\"full\": \"pics/resized/1200x750/album0/4.jpg\",\
			\"orig\": \"pics/original/album0/4.jpg\",\
			\"type\": \"image/jpeg\"\
		},\
		{\
			\"path\": \"pics/resized/360x225/album0/5.jpg\",\
			\"full\": \"pics/resized/1200x750/album0/5.jpg\",\
			\"orig\": \"pics/original/album0/5.jpg\",\
			\"type\": \"image/jpeg\"\
		}\
	]\
}" > ${DIR}/pics/index/album0/index.json

mkdir -vp ${DIR}/pics/index/album1
echo "{\
    \"path\": \"pics/original/album1\",\
	\"title\": \"album1\",\
	\"albums\": [],\
	\"items\": [\
		{\
			\"path\": \"pics/resized/360x225/album1/0.jpg\",\
			\"full\": \"pics/resized/1200x750/album1/0.jpg\",\
			\"orig\": \"pics/original/album1/0.jpg\",\
			\"type\": \"image/jpeg\"\
		},\
		{\
			\"path\": \"pics/resized/360x225/album1/1.jpg\",\
			\"full\": \"pics/resized/1200x750/album1/1.jpg\",\
			\"orig\": \"pics/original/album1/1.jpg\",\
			\"type\": \"image/jpeg\"\
		},\
		{\
			\"path\": \"pics/resized/360x225/album1/2.jpg\",\
			\"full\": \"pics/resized/1200x750/album1/2.jpg\",\
			\"orig\": \"pics/original/album1/2.jpg\",\
			\"type\": \"image/jpeg\"\
		},\
		{\
			\"path\": \"pics/resized/360x225/album1/3.jpg\",\
			\"full\": \"pics/resized/1200x750/album1/3.jpg\",\
			\"orig\": \"pics/original/album1/3.jpg\",\
			\"type\": \"image/jpeg\"\
		},\
		{\
			\"path\": \"pics/resized/360x225/album1/4.jpg\",\
			\"full\": \"pics/resized/1200x750/album1/4.jpg\",\
			\"orig\": \"pics/original/album1/4.jpg\",\
			\"type\": \"image/jpeg\"\
		},\
		{\
			\"path\": \"pics/resized/360x225/album1/5.jpg\",\
			\"full\": \"pics/resized/1200x750/album1/5.jpg\",\
			\"orig\": \"pics/original/album1/5.jpg\",\
			\"type\": \"image/jpeg\"\
		}\
	]\
}" > ${DIR}/pics/index/album1/index.json
