#!/bin/bash
set -euox pipefail

# wget https://huggingface.co/fancyfeast/joytag/resolve/main/model.onnx -O joytag/joytag.onnx
# wget https://huggingface.co/fancyfeast/joytag/resolve/main/top_tags.txt -O joytag/top-tags.txt
wget https://huggingface.co/fancyfeast/joytag/resolve/main/model.safetensors -O joytag/model.safetensors
