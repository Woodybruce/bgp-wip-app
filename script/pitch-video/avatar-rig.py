# Builds the character rig for the pitch film from the keyed drawings: the
# bodies, the presenter's three gesture forearms (cut from the pose drawings
# and matched to his skin tone), and where each face's mouth and eyes are.
import json, numpy as np
from PIL import Image, ImageDraw
import sys
D = sys.argv[1].rstrip("/") + "/"   # the folder with the keyed drawings
def load(n): return Image.open(D + n + ".png").convert("RGBA")
def med(im, x, y, r=6):
    a = np.asarray(im)[y - r:y + r, x - r:x + r, :3].reshape(-1, 3); return [int(v) for v in np.median(a, axis=0)]
def hexc(c): return "#%02x%02x%02x" % tuple(c)
rig = {}

rest = load("woody-rest")
skin = med(rest, 120, 1750)
# The same body with the hanging forearm on the picture's left taken away, for when a gesture arm is on.
noarm = rest.copy(); m = Image.new("L", rest.size, 255)
ImageDraw.Draw(m).polygon([(0, 1500), (236, 1538), (252, 2011), (0, 2011)], fill=0)
a = np.asarray(noarm).copy(); a[..., 3] = np.minimum(a[..., 3], np.asarray(m)); Image.fromarray(a).save(D + "woody-noarm.png")

def forearm(src, box, keep, pivot, scale, mirror=False, name=""):
    im = load(src); a = np.asarray(im).copy()
    ys, xs = np.mgrid[0:a.shape[0], 0:a.shape[1]]
    a[..., 3] = np.where(keep(xs, ys), a[..., 3], 0)
    # Match the skin to the body's: every warm pixel is moved by the ratio of the two skin tones.
    rgb = a[..., :3].astype(np.float32); r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    warm = (r > b + 35) & (r > 110) & (a[..., 3] > 0) & ~((r > 235) & (g > 235))
    if warm.any():
        src_skin = np.median(rgb[warm], axis=0); rgb[warm] = np.clip(rgb[warm] * (np.array(skin) / src_skin), 0, 255)
    a[..., :3] = rgb.astype(np.uint8)
    out = Image.fromarray(a).crop(box); px, py = pivot[0] - box[0], pivot[1] - box[1]
    if mirror: out = out.transpose(Image.FLIP_LEFT_RIGHT); px = out.size[0] - px
    out = out.resize((round(out.size[0] * scale), round(out.size[1] * scale)), Image.LANCZOS)
    out.save(D + name + ".png")
    return dict(src=name + ".png", w=out.size[0], h=out.size[1], pivot=[round(px * scale), round(py * scale)])
arms = dict(
  point=forearm("woody-point", (0, 520, 540, 1640), lambda x, y: x < 525, (448, 1437), 0.94, name="arm-point"),
  thumb=forearm("woody-thumb", (1380, 590, 1745, 1800), lambda x, y: (x > 1445) | ((y > 1420) & (x > 1392)), (1556, 1689), 0.79, mirror=True, name="arm-thumb"),
  wave=forearm("woody-wave", (0, 90, 450, 1020), lambda x, y: x < np.clip(444 - (y - 505) * 1.75, 244, 444), (122, 933), 1.22, name="arm-wave"))
rig["woody"] = dict(body="woody-rest.png", bodyNoArm="woody-noarm.png", w=rest.size[0], h=rest.size[1], head=dict(top=9, chin=661, cx=653),
  mouth=dict(x=656, y=527, w=170), eyes=[[570, 363], [737, 363]], eyeW=72, skin=hexc(med(rest, 656, 600)), lid=hexc(med(rest, 560, 430)), elbow=[117, 1468], arms=arms)

c = load("charlotte-rest")
rig["charlotte"] = dict(body="charlotte-rest.png", w=c.size[0], h=c.size[1], head=dict(top=11, chin=867, cx=718),
  mouth=dict(x=718, y=711, w=215), eyes=[[589, 473], [856, 473]], eyeW=120, skin=hexc(med(c, 718, 800)), lid=hexc(med(c, 600, 560)))
k = load("mark-rest")
rig["mark"] = dict(body="mark-rest.png", w=k.size[0], h=k.size[1], head=dict(top=11, chin=1100, cx=933),
  mouth=dict(x=933, y=884, w=280), eyes=[[789, 611], [1067, 611]], eyeW=130, skin=hexc(med(k, 860, 950)), lid=hexc(med(k, 790, 700)))
d = load("david-wave"); rig["david"] = dict(body="david-wave.png", w=d.size[0], h=d.size[1], head=dict(top=60, chin=560, cx=870))
h = load("hero-fly"); rig["hero"] = dict(body="hero-fly.png", w=h.size[0], h=h.size[1])
json.dump(rig, open(D + "rig.json", "w"), indent=1)
print(json.dumps({k: {kk: vv for kk, vv in v.items() if kk in ("w", "h", "skin", "lid", "arms")} for k, v in rig.items()})[:900])
