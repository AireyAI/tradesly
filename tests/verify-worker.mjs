import assert from 'node:assert/strict';
import worker from '../worker.mjs';
import {LAUNCH} from '../launch-config.mjs';
const records=new Map();
const env={TRADESLY_KV:{put:async(k,v)=>records.set(k,JSON.parse(v))}};
const request=(route,payload)=>new Request(`https://tradesly.co.uk${route}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
const lead={niche_slug:LAUNCH.niche,postcode:'BS6 5AA',email:'website-test@example.com',problem:'Test only: cut back borders and tidy a small garden.',gdpr_consent:true,gdpr_consent_at:new Date().toISOString(),consent_version:LAUNCH.consentVersion};
let checks=0;
for(const patch of [{niche_slug:'electrical'},{postcode:'M20 6FR'},{postcode:'BS6'},{gdpr_consent:false},{email:'invalid'}]){
 const before=records.size;const response=await worker.fetch(request('/api/lead',{...lead,...patch}),env,{});
 assert.equal(response.status,400);assert.equal(records.size,before);checks++;
}
const response=await worker.fetch(request('/api/lead',lead),env,{});assert.equal(response.status,200);
const result=await response.json();const stored=records.get('lead:'+result.lead_id);
assert.equal(stored.matching_policy,'exclusive');assert.equal(stored.consumer.consent_version,LAUNCH.consentVersion);assert.equal(stored.consumer.consent_scope,'exclusive');checks++;
const buyer={business_name:'Preview test business',contact_name:'Test only',email:'website-test@example.com',phone:'07700900000',niches:[LAUNCH.niche],postcodes:['BS3','BS6'],daily_cap:1,tiers:['T1'],terms_consent:true,terms_version:LAUNCH.consentVersion};
for(const patch of [{niches:['electrical']},{postcodes:['M20']},{postcodes:[' ']},{terms_consent:false}]){
 const before=records.size;const response=await worker.fetch(request('/api/buyer-apply',{...buyer,...patch}),env,{});
 assert.equal(response.status,400);assert.equal(records.size,before);checks++;
}
const accepted=await worker.fetch(request('/api/buyer-apply',buyer),env,{});assert.equal(accepted.status,200);const acceptedBody=await accepted.json();const partner=records.get('buyer_pending:'+acceptedBody.buyer_id);assert.equal(partner.terms_version,LAUNCH.consentVersion);assert.equal(partner.matching_policy,'exclusive');checks++;
const pitch=await worker.fetch(new Request('https://tradesly.co.uk/pitch?niche=solar&ref=old-pitch'),env,{});
assert.equal(pitch.status,302);assert.equal(pitch.headers.get('location'),'https://tradesly.co.uk/for-tradespeople.html?niche=solar&ref=old-pitch');checks++;
console.log(JSON.stringify({checks,passed:true,storage:'in-memory mock only',externalRequests:0},null,2));
