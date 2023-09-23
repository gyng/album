# index

Indexes images for search with the following fields

|           |                                                          |
| --------- | -------------------------------------------------------- |
| EXIF      | excluding binary data                                    |
| Geography | taken from EXIF and roughly geocoded to country and city |
| Tags      | classified using YOLOv8/ImageNet                         |
| Colours   | RGB values                                               |
| Filename  |                                                          |

## Usage

```
$ poetry run python index.py --help
$ poetry run python index.py index --glob "../src/public/data/albums/test-simple/*.jpg"
$ poetry run python index.py index --glob "../src/public/data/albums/**/*.jpg" --dbpath "search.sqlite" --dry-run
$ poetry run python index.py search --query "singapore"
$ poetry run python index.py inspect
$ cp search.sqlite ../src/public/search.sqlite
$ ./full-index.sh
```

## Prerequisites

- CUDA/GPU access ([WSL2 instructions](https://developer.nvidia.com/cuda-downloads?target_os=Linux&target_arch=x86_64&Distribution=WSL-Ubuntu&target_version=2.0&target_type=deb_local))
- Python 3.11
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
