import sys
files=[("index.html","index.html"),("game.js","game.js"),("three.min.js","three.min.js"),
       ("WebView2Loader.dll","WebView2Loader.dll")]
out=["#include \"embedded.h\"\n"]
names=[]
for path,virt in files:
    data=open(path,'rb').read()
    name=virt.replace('.','_').replace('-','_')
    names.append((virt,name))
    out.append(f"static const unsigned char d_{name}[]={{")
    for i in range(0,len(data),20):
        out.append(','.join(str(b) for b in data[i:i+20])+',')
    out.append("};\n")
out.append("const EmbeddedFile EMBEDDED_FILES[]={")
for virt,name in names:
    out.append(f'{{"{virt}",d_{name},sizeof(d_{name})}},')
out.append("};\nconst int EMBEDDED_COUNT=sizeof(EMBEDDED_FILES)/sizeof(EMBEDDED_FILES[0]);\n")
open('embedded.cpp','w').write('\n'.join(out))
open('embedded.h','w').write('#pragma once\nstruct EmbeddedFile{const char*name;const unsigned char*data;unsigned int size;};\nextern const EmbeddedFile EMBEDDED_FILES[];\nextern const int EMBEDDED_COUNT;\n')
