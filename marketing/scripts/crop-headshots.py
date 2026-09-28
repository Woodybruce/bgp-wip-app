import cv2, os, sys, numpy as np
from PIL import Image, ImageOps, ImageFilter, ImageEnhance
SP="/tmp/claude-0/-home-user/99d43de5-e54d-5c6f-a1ad-9b9246e57bfb/scratchpad"
SRC=SP+"/src"; BUN="/home/user/bgp-wip-app/marketing/public/images/team"; OUT=SP+"/out"
# person slug -> best source
share={"woody-bruce":"Woody Bruce","tracey-pollard":"Tracey Pollard","charlotte-roberts":"Charlotte2022BW",
 "rupert-bentley-smith":"Rupert Bentley-Smith","jack-barratt":"Jack Barratt","victoria-broadhead":"Victoria Broadhead",
 "peter-wood":"Pete Wood","nick-halley":"Nick Halley","lucy-gardiner":"Lucy Gardiner","lizzie-knights":"Lizzie Knights",
 "harry-elliott":"Harry Elliot","emily-dumbell":"Emily Dumbell","nick-goodman":"Nick Goodman","tom-cater":"Tom Cater",
 "lucy-cope":"Lucy Cope","evie-north":"Evie North","alex-todd":"Alex Todd","millie-edwards":"Millie Edwards",
 "will-penfold":"Will Penfold","libby-evans":"Libby Evans","layla-odriscoll":"Layla O'Driscoll","cara-milligan":"Cara Milligan"}
bundled_only=["emily-cann","jonny-palmer","luke-donohoe"]
casc=[cv2.CascadeClassifier(cv2.data.haarcascades+n) for n in ("haarcascade_frontalface_default.xml","haarcascade_frontalface_alt2.xml","haarcascade_profileface.xml")]
W,H=900,1200
FACE_FRAC=0.47   # face box width as fraction of output width
FACE_CY=0.44     # face centre as fraction of output height
def face(gray):
    best=None
    for c in casc:
        for mn in (6,4,3):
            f=c.detectMultiScale(gray,1.05,mn,minSize=(int(gray.shape[1]*0.08),)*2)
            if len(f): 
                b=max(f,key=lambda r:r[2]*r[3])
                if best is None or b[2]*b[3]>best[2]*best[3]: best=b
                break
        if best is not None: break
    return best
def grade(im):
    im=ImageOps.autocontrast(im,cutoff=(0.4,0.8))
    a=np.asarray(im).astype(np.float32)/255
    a=a+0.12*np.sin(np.pi*(a-0.5))*(1-np.abs(2*a-1))*0+0.10*(a-0.5)*(1-np.abs(2*a-1))  # gentle S
    im=Image.fromarray(np.clip(a*255,0,255).astype(np.uint8))
    return im
log=[]
jobs=[(s,os.path.join(SRC,share[s]+".jpg")) for s in share]+[(s,os.path.join(BUN,s+".jpg")) for s in bundled_only]
for slug,path in jobs:
    pil=ImageOps.exif_transpose(Image.open(path)).convert("L")
    g=np.asarray(pil)
    f=face(cv2.equalizeHist(g))
    if f is None: log.append(f"{slug}: NO FACE"); continue
    x,y,w,h=f
    cw=w/FACE_FRAC; ch=cw*H/W
    cx=x+w/2; cy=y+h/2
    left=cx-cw/2; top=cy-FACE_CY*ch
    iw,ih=pil.size
    # if crop is bigger than image, shrink (face gets bigger) rather than invent pixels
    s=min(1,iw/cw,ih/ch)
    cw*=s; ch*=s
    left=cx-cw/2; top=cy-FACE_CY*ch
    left=min(max(left,0),iw-cw); top=min(max(top,0),ih-ch)
    crop=pil.crop((int(left),int(top),int(left+cw),int(top+ch))).resize((W,H),Image.LANCZOS)
    up=W/cw
    if up>1.3: crop=crop.filter(ImageFilter.UnsharpMask(radius=2,percent=60,threshold=3))
    crop=grade(crop)
    crop.save(os.path.join(OUT,slug+".jpg"),quality=88,optimize=True,progressive=True)
    log.append(f"{slug}: src {iw}x{ih} face {w}px scale {s:.2f} upscale {up:.2f}")
print("\n".join(log))
fs=sorted(os.listdir(OUT)); cols=9; tw,th=150,200
sheet=Image.new("L",(cols*tw,((len(fs)+cols-1)//cols)*th),255)
for i,fn in enumerate(fs): sheet.paste(Image.open(os.path.join(OUT,fn)).resize((tw,th)),((i%cols)*tw,(i//cols)*th))
sheet.save(SP+"/sheet2.jpg")
