# Independent reference implementation of LegacyRandom / StatelessRNG, written from the C# source.
import json
M32=0xFFFFFFFF; M64=(1<<64)-1
class LR:
    def __init__(s,seed): s.x=seed&M32; s.y=842502087; s.z=3579807591; s.w=273326509; s.bb=0; s.bi=32
    def u(s):
        t=(s.x^(s.x<<11))&M32; s.x=s.y; s.y=s.z; s.z=s.w
        s.w=(s.w^(s.w>>19)^t^(t>>8))&M32; return s.w
    def nxt(s): return s.u()&0x7FFFFFFF
    def d(s): return s.nxt()*(1.0/2147483648.0)
    def rng(s,lo,hi): return int(lo+s.d()*(hi-lo))
    def b(s):
        if s.bi==32:
            s.bb=s.u(); s.bi=1; return (s.bb&1)==1
        s.bi+=1; s.bb>>=1; return (s.bb&1)==1
def mix(x):
    x^=x>>33; x=(x*0xff51afd7ed558ccd)&M64; x^=x>>33; x=(x*0xc4ceb9fe1a85ec53)&M64; x^=x>>33; return x
def ul(seed,series=0): return mix(((((series)&M32)<<32)|(seed&M32))^0x12345678)
r=LR(1337)
out={'legacy':[r.nxt() for _ in range(5)]}
r=LR(1337); out['double']=[r.d() for _ in range(3)]
r=LR(1337); out['range']=[r.rng(-20,20) for _ in range(8)]
r=LR(1337); out['bool']=[r.b() for _ in range(40)]
out['sl']=[[s,k,str(ul(s,k)), ul(s,k)%3, (ul(s,k)&0xFFFFFF)/16777216] for s,k in [(0,0),(1000,1),(1234,2),(98765,3),(250000,1)]]
print(json.dumps(out))
