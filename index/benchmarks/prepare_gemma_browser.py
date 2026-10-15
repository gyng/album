"""Replace GatherBlockQuantized with equivalent standard ONNX row operations.

The pinned export uses an operator absent from ORT's WASM build. Only the small
model graph changes. The original quantised weights stay byte-identical.
Run with an environment containing onnx and numpy. Verify numerical parity before
shipping a regenerated graph.
"""

import argparse
from pathlib import Path

import numpy as np
import onnx
from onnx import helper, numpy_helper


def prepare(source: Path, output: Path):
    model = onnx.load(source, load_external_data=False)
    nodes = []
    replaced = 0
    constants = {
        "eg2_sixteen": np.asarray(16, dtype=np.int32),
        "eg2_axes": np.asarray([-1], dtype=np.int64),
    }
    tensors = {t.name: t for t in model.graph.initializer}

    def node(op, inputs, output, **attrs):
        nodes.append(helper.make_node(op, inputs, [output], **attrs))

    for original in model.graph.node:
        if original.op_type != "GatherBlockQuantized":
            nodes.append(original)
            continue
        attrs = {a.name: a.i for a in original.attribute}
        if attrs != {"bits": 4, "block_size": 32, "gather_axis": 0, "quantize_axis": 1}:
            raise ValueError(f"Unexpected quantisation: {attrs}")
        weights, ids, scales, zeros = original.input
        width = tensors[weights].dims[-1] * 2
        prefix = f"eg2_{replaced}"
        blocks = width // 32
        constants[prefix + "_blocks"] = np.asarray([-1, blocks, 32], dtype=np.int64)
        constants[prefix + "_rows"] = np.asarray([-1, blocks], dtype=np.int64)
        constants[prefix + "_width"] = np.asarray([width], dtype=np.int64)

        def unpack(name, tensor, shape, ids=ids):
            node("Gather", [tensor, ids], name + "_packed", axis=0)
            node("Cast", [name + "_packed"], name + "_int", to=onnx.TensorProto.INT32)
            node("Mod", [name + "_int", "eg2_sixteen"], name + "_lo")
            node("Div", [name + "_int", "eg2_sixteen"], name + "_hi")
            node("Unsqueeze", [name + "_lo", "eg2_axes"], name + "_lo_axis")
            node("Unsqueeze", [name + "_hi", "eg2_axes"], name + "_hi_axis")
            node(
                "Concat",
                [name + "_lo_axis", name + "_hi_axis"],
                name + "_pairs",
                axis=-1,
            )
            node("Reshape", [name + "_pairs", shape], name + "_unpacked")
            node("Cast", [name + "_unpacked"], name, to=onnx.TensorProto.FLOAT)

        unpack(prefix + "_quant", weights, prefix + "_blocks")
        unpack(prefix + "_zero", zeros, prefix + "_rows")
        node("Gather", [scales, ids], prefix + "_scale_raw", axis=0)
        node("Reshape", [prefix + "_scale_raw", prefix + "_rows"], prefix + "_scale")
        node("Unsqueeze", [prefix + "_scale", "eg2_axes"], prefix + "_scale_axis")
        node("Unsqueeze", [prefix + "_zero", "eg2_axes"], prefix + "_zero_axis")
        node("Sub", [prefix + "_quant", prefix + "_zero_axis"], prefix + "_centred")
        node("Mul", [prefix + "_centred", prefix + "_scale_axis"], prefix + "_dequant")
        node("Shape", [ids], prefix + "_id_shape")
        node(
            "Concat",
            [prefix + "_id_shape", prefix + "_width"],
            prefix + "_output_shape",
            axis=0,
        )
        node(
            "Reshape",
            [prefix + "_dequant", prefix + "_output_shape"],
            original.output[0],
        )
        replaced += 1
    if not replaced:
        raise ValueError("No quantised gather found")
    del model.graph.node[:]
    model.graph.node.extend(nodes)
    model.graph.initializer.extend(
        numpy_helper.from_array(v, k) for k, v in constants.items()
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    onnx.save_model(model, output)
    print(f"Wrote browser graph: {output} ({output.stat().st_size} bytes)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    prepare(args.source, args.output)
