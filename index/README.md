# index

Indexes images for search with the following fields

| Table        | Column              | Frontend     | Notes                             |
| ------------ | ------------------- | ------------ | --------------------------------- |
| fts5(images) | path                |              |                                   |
| fts5(images) | album_relative_path |              |                                   |
| fts5(images) | filename            |              |                                   |
| fts5(images) | EXIF                | searched     | excluding binary data             |
| fts5(images) | geocode             | searched     | geocoded to country and city      |
| fts5(images) | tags                | searched     | classified using Janus-Pro-1B     |
| fts5(images) | colors              | placeholder  | median cut (top 5); `[r, g, b][]` |
| tags         | tag                 |              | primary key, Janus-Pro-1B         |
| tags         | count               | autocomplete | tags count                        |
| metadata     | path                |              | primary key                       |
| metadata     | lat_deg             | map          |                                   |
| metadata     | lng_deg             | map          |                                   |
| metadata     | iso8601             |              | assumed UTC                       |

The [FTS5 SQLite extension](https://www.sqlite.org/fts5.html) requires sqlite3 >= 3.34.0 and creates a virtual table.

Full indexing of ~1000 images takes around 3+ minutes. First run will download model weights which takes some time.

## Usage

```sh
$ poetry run python index.py --help
$ poetry run python index.py index --glob "../src/public/data/albums/test-simple/*.jpg"
$ poetry run python index.py index --glob "../src/public/data/albums/**/*.jpg" --dbpath "search.sqlite" --dry-run
$ poetry run python index.py search --query "singapore"

$ poetry run python index.py dump
$ poetry run python index.py search-tags --query "dam"
$ poetry run python index.py search-metadata --query "D"

$ poetry run python index.py prune --glob "../src/public/data/albums/**/*.jpg" --dbpath "search.sqlite" --dry-run

$ cp search.sqlite ../src/public/search.sqlite

# Test
$ ./create-test-db.sh
$ ./do-test-index.sh

# Perform a full index and copy it to /public in the Next.js app
$ ./do-full-index.sh
```

## Prerequisites

- CUDA/GPU access ([WSL2 instructions](https://developer.nvidia.com/cuda-downloads?target_os=Linux&target_arch=x86_64&Distribution=WSL-Ubuntu&target_version=2.0&target_type=deb_local))
- Python 3.12
- sqlite3 >= 3.34.0

## WSL2

- CUDA/GPU access ([WSL2 instructions](https://developer.nvidia.com/cuda-downloads?target_os=Linux&target_arch=x86_64&Distribution=WSL-Ubuntu&target_version=2.0&target_type=deb_local))

If you encounter `Could not load library libcudnn_cnn_infer.so.8`

Add this to `~/.bashrc`

```
export LD_LIBRARY_PATH=/usr/lib/wsl/lib:$LD_LIBRARY_PATH
```

Don't forget to source it

```sh
$ source ~/.bashrc
```

See: https://discuss.pytorch.org/t/libcudnn-cnn-infer-so-8-library-can-not-found/164661
