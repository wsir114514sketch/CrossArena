"""Phase 0 probe: can this Blender build render with EEVEE in background mode?

Usage:
  blender -b --factory-startup --python asset_pipeline/probes/eevee_probe.py -- --out <png_path>

The EEVEE engine identifier is detected at runtime (it changed across Blender
versions: BLENDER_EEVEE / BLENDER_EEVEE_NEXT), never hard-coded.
"""
import sys
import time

import bpy


def _args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = "probe.png"
    if "--out" in argv:
        out = argv[argv.index("--out") + 1]
    return out


def detect_eevee_engine():
    items = bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items
    ids = [e.identifier for e in items]
    eevee = [i for i in ids if "EEVEE" in i]
    return ids, (eevee[0] if eevee else None)


def main():
    out = _args()
    scene = bpy.context.scene
    ids, engine = detect_eevee_engine()
    print("PROBE engines=%s eevee=%s" % (ids, engine))
    if engine is None:
        print("PROBE result=FAIL reason=no_eevee_engine")
        sys.exit(2)
    scene.render.engine = engine

    # view_transform is a dynamic enum (depends on the OCIO config), so bl_rna
    # cannot list it reliably; set it and read it back instead.
    try:
        scene.view_settings.view_transform = "Standard"
    except TypeError as exc:
        print("PROBE view_transform_error=%s" % exc)
    print("PROBE view_transform=%s" % scene.view_settings.view_transform)

    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.resolution_x = 256
    scene.render.resolution_y = 256
    scene.render.resolution_percentage = 100

    cam = scene.camera
    if cam is not None:
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = 4.0
        cam.location = (0.0, -10.0, 0.0)
        cam.rotation_euler = (1.5707963, 0.0, 0.0)

    scene.render.filepath = out
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    dt = time.time() - t0

    img = bpy.data.images.load(out)
    w, h = img.size
    px = list(img.pixels)
    corner_alpha = px[3]
    alphas = px[3::4]
    opaque = sum(1 for a in alphas if a > 0.5)
    print("PROBE result=OK engine=%s size=%dx%d corner_alpha=%.3f opaque_px=%d seconds=%.2f"
          % (engine, w, h, corner_alpha, opaque, dt))


main()
