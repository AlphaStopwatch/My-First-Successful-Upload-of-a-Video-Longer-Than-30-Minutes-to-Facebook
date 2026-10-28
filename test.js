const a=require('assert'),m=require('./script.js');const D=(s)=>Date.parse(s);
const S=m.START_MS;
a(m.START_OK);a.equal(S,D('2026-10-28T22:59:00.000Z'));a.equal(new Date(S).toISOString(),'2026-10-28T22:59:00.000Z');
const el=(sec,ns=0n)=>m.splitTotals(BigInt(sec)*1000000000n+ns);
a.equal(el(0).S,0n);a.equal(el(1).sec,1n);a.equal(el(59).sec,59n);a.equal(el(60).min,1n);a.equal(el(60).sec,0n);
let t=el(3599);a.equal([t.min,t.sec,t.H].join(),'59,59,0');t=el(3600);a.equal(t.H,1n);
t=el(86399);a.equal([t.hr,t.min,t.sec,t.days].join(),'23,59,59,0');t=el(86400);a.equal(t.days,1n);a.equal(t.H,24n);
t=el(86400*400+5);a.equal(t.days,400n);
// big values
const big=10n**40n+12345n;t=m.splitTotals(big*1000000000n+123456789n);a.equal(t.S,big);a.equal(t.nsRem,123456789n);a.equal(m.group(t.S).replace(/\u2009/g,''),big.toString());
t=el(2n**53n+1n);a.equal(t.S,2n**53n+1n); a(!/e/i.test(m.group(10n**30n)));
a.equal(el(0,1n).nsRem,1n);a.equal(el(0,999999999n).nsRem,999999999n);
// calendar (Dhaka +6)
const O=6*3600000,c=(iso)=>m.calendarDiff(S,D(iso),O);
a.deepEqual(c('2026-10-28T22:59:00Z'),{y:0,mo:0,d:0,h:0,mi:0,s:0});
a.deepEqual(c('2026-10-28T22:59:59Z'),{y:0,mo:0,d:0,h:0,mi:0,s:59});
a.deepEqual(c('2026-10-29T22:59:00Z'),{y:0,mo:0,d:1,h:0,mi:0,s:0});            // midnight crossing
a.deepEqual(c('2026-11-28T22:59:00Z'),{y:0,mo:1,d:0,h:0,mi:0,s:0});            // month boundary
a.deepEqual(c('2027-10-28T22:59:00Z'),{y:1,mo:0,d:0,h:0,mi:0,s:0});            // year boundary
a.deepEqual(c('2028-02-28T22:59:00Z'),{y:1,mo:4,d:0,h:0,mi:0,s:0});            // leap-year era
a.deepEqual(c('2028-02-29T22:59:00Z'),{y:1,mo:4,d:1,h:0,mi:0,s:0});
a.equal(m.calendarDiff(S,S-1,O),null);
console.log('all tests passed');
