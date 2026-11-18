# keywhite.py in.jpg out.png : the white the figure stands on to clear. Only white
# joined to the picture's edge goes, so teeth and the whites of eyes stay.
import sys, numpy as np
from PIL import Image
from scipy import ndimage
im = np.asarray(Image.open(sys.argv[1]).convert("RGB")).astype(np.float32)
light = im.min(axis=2) > 232
lab, n = ndimage.label(light)
edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
bg = np.isin(lab, list(edge))
bg = ndimage.binary_dilation(bg, iterations=2)          # take the pale rim with it
alpha = ndimage.gaussian_filter((~bg).astype(np.float32), 0.9)
out = np.dstack([im, alpha * 255]).clip(0, 255).astype(np.uint8)
ys, xs = np.where(alpha > 0.5)
box = (max(0, xs.min() - 6), max(0, ys.min() - 6), min(im.shape[1], xs.max() + 6), min(im.shape[0], ys.max() + 6))
Image.fromarray(out).crop(box).save(sys.argv[2])
print(sys.argv[2], "size", box[2] - box[0], box[3] - box[1])
