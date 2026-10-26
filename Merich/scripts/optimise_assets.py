"""Rebuild the exact site image variants from retained source PNGs; Pillow required."""
from pathlib import Path
from PIL import Image
import io,json,hashlib
root=Path(__file__).resolve().parents[1]
assets=root/'assets'
assets.mkdir(exist_ok=True)
manifest=[]
def save_webp(key,name,max_edge,quality=85,limit=250*1024):
    im=Image.open(root/'design/originals'/f'{key}.png')
    im.thumbnail((max_edge,max_edge),Image.Resampling.LANCZOS)
    while True:
        data=io.BytesIO();im.save(data,'WEBP',quality=quality,method=6)
        if len(data.getvalue())<=limit or quality<=70:break
        quality-=3
    if len(data.getvalue())>limit:raise RuntimeError(f'{name} exceeded target image size')
    path=assets/name;path.write_bytes(data.getvalue())
    manifest.append({'file':'assets/'+name,'source':'design/originals/'+key+'.png','width':im.width,'height':im.height,'bytes':path.stat().st_size,'quality':quality,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
for key in ['hero','kitchen']:
    save_webp(key,key+'.webp',1800)
    save_webp(key,key+'-small.webp',960,83,130*1024)
for key in ['jollof','fried-rice','vegetable-soup']:save_webp(key,key+'.webp',960,87,160*1024)
save_webp('logo','logo.webp',512,92,100*1024)
logo=Image.open(root/'design/originals/logo.png');logo.thumbnail((64,64),Image.Resampling.LANCZOS);logo.save(assets/'favicon.png',optimize=True)
hero=Image.open(root/'design/originals/hero.png').convert('RGB');hero.thumbnail((1200,630),Image.Resampling.LANCZOS);hero.save(assets/'hero-share.jpg',quality=83,optimize=True)
for file in ['favicon.png','hero-share.jpg']:
    path=assets/file
    with Image.open(path) as im:manifest.append({'file':'assets/'+file,'width':im.width,'height':im.height,'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
(root/'design/asset-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps([{'file':x['file'],'bytes':x['bytes']} for x in manifest]))
