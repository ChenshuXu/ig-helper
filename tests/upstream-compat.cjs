const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = file => fs.readFileSync(`${__dirname}/../src/${file}`, 'utf8');
const strip = source => source.split('/*! ESLINT IMPORT END !*/')[1]
    .replaceAll('export async function ', 'async function ').replaceAll('export function ', 'function ');
const api = strip(read('utils/api.js'));
const photo = {id:'201_42',media_type:1,taken_at:20,video_versions:[],
    image_versions2:{candidates:[{url:'small.jpg',width:320},{url:'large.jpg',width:1080}]}};
const video = {id:'202_42',media_type:2,taken_at:21,
    image_versions2:{candidates:[{url:'cover.jpg',width:1080}]},video_versions:[{url:'video.mp4',width:1080}]};
const reel = {id:'42',user:{username:'FixtureOwner'},items:[photo,video]};
function setup() {
    const requests = [];
    const context = vm.createContext({
        document:{querySelector:()=>null,querySelectorAll:()=>[]},
        logger(){},FormData,AbortController,setTimeout,clearTimeout,userIdCache:new Map(),
        getInstagramRequestContext:()=>({appID:'fixture-app',dtsg:'fixture-dtsg',lsd:'fixture-lsd',
            userID:'42',csrfToken:'fixture-csrf',siteData:{client_revision:'1'}}),
        GM_xmlhttpRequest:request=>requests.push(request)
    });
    vm.runInContext(api,context);
    const respond = body => requests.at(-1).onload({status:200,response:JSON.stringify(body)});
    return {context,requests,respond};
}
function popup(context) {
    let html='',message='',disabled=true,loading;
    const node={
        empty(){html='';message='';return node;},append(value){html+=value;return node;},
        text(value){message=value;return node;},find(){return node;},each(){return node;},
        prop(_key,value){disabled=value;return node;},first(){return node;}
    };
    Object.assign(context,{$:()=>node,USER_SETTING:{RENAME_PUBLISH_DATE:true},SVG:{},
        _i18n:v=>v,updatePopupSelectionSummary(){},updateLoadingBar:v=>{loading=v;},IG_createDM(){},
        location:{pathname:'/stories/FixtureOwner/201/',href:'https://www.instagram.com/stories/highlights/99/'}});
    vm.runInContext(strip(read('functions/story.js')),context);
    return {state:()=>({html,message,disabled,loading})};
}
(async()=>{
    const t=setup();
    const pending=t.context.getStories('42');
    assert.equal(t.requests.length,1);
    assert.equal(t.requests[0].method,'POST');
    assert.equal(t.requests[0].data.get('fb_api_req_friendly_name'),'PolarisStoriesV3ReelPageStandaloneQuery');
    assert.equal(t.requests[0].data.get('doc_id'),'29170422829314651');
    assert.equal(t.requests[0].data.get('jazoest'),'21254');
    assert.equal(t.requests[0].data.get('__rev'),'1');
    assert.equal(t.requests[0].headers['X-CSRFToken'],'fixture-csrf');
    assert.equal(t.requests[0].timeout,20000);
    t.respond({data:{xdt_api__v1__feed__reels_media:{reels_media:[reel]}}});
    const stories=await pending;
    assert.equal(stories.data.reels_media[0].items[0].id,'201');
    assert.equal(stories.data.reels_media[0].items[0].display_url,'large.jpg');
    assert.equal(stories.data.reels_media[0].items[0].is_video,false);
    assert.equal(stories.data.reels_media[0].items[0].video_versions,null);
    assert.equal(stories.data.reels_media[0].items[1].video_resources[0].src,'video.mp4');
    assert.equal(photo.image_versions2.candidates[0].url,'small.jpg','normalization must not mutate page data');
    const p=popup(t.context);
    assert.equal(await t.context.createStoryListDOM(stories,'stories'),2);
    assert.equal(p.state().disabled,false);
    assert.match(p.state().html,/data-type="jpg"/);
    assert.match(p.state().html,/data-type="mp4"/);
    assert.match(p.state().html,/data-href="large.jpg"/);
    assert.equal(await t.context.createStoryListDOM({data:{reels_media:[{...reel,items:[{...video,video_versions:[]}]}]}},'stories'),0);
    assert.match(p.state().message,/incomplete/);
    assert.equal(p.state().disabled,true);
    assert.equal(p.state().loading,false);
    assert.ok(!p.state().html.includes('<a '),'failed lists must not leave partial downloads');

    const h=setup();
    const highlights=h.context.getHighlightStories('99');
    assert.equal(h.requests[0].data.get('fb_api_req_friendly_name'),'PolarisStoriesV3HighlightsPageQuery');
    const highlight={...reel,id:'highlight:99'};
    h.respond({data:{xdt_api__v1__feed__reels_media__connection:{edges:[{node:highlight}]}}});
    const normalized=await highlights;
    assert.equal(normalized.data.reels_media[0].owner.username,'FixtureOwner');
    assert.equal(normalized.data.reels_media[0].items.length,2);
    const incomplete=h.context.getHighlightStories('99');
    h.respond({data:{xdt_api__v1__feed__reels_media__connection:{page_info:{has_next_page:true},edges:[{node:highlight}]}}});
    await assert.rejects(incomplete,/incomplete Highlight/);
    h.context.document.querySelectorAll=()=>[{textContent:JSON.stringify({reels_media:[highlight]})}];
    assert.equal((await h.context.getHighlightStories('99')).data.reels_media[0].id,'highlight:99');
    assert.equal(h.requests.length,2,'loaded Highlights bypass remote requests');

    const missing=setup();missing.context.getInstagramRequestContext=()=>({siteData:{}});
    await assert.rejects(missing.context.getStories('42'),/request data is unavailable/);
    assert.equal(missing.requests.length,0,'missing page tokens must not generate a broken request');
    const limited=setup();
    const blocked=limited.context.getStories('42');
    limited.requests[0].onload({status:429,response:'<html>Too many requests</html>'});
    await assert.rejects(blocked,e=>e.code==='POST_RATE_LIMITED');
    await assert.rejects(limited.context.getHighlightStories('99'),e=>e.code==='POST_RATE_LIMITED');
    await assert.rejects(limited.context.getBlobMedia('Unknown'),e=>e.code==='POST_RATE_LIMITED');
    assert.equal(limited.requests.length,1,'media calls stop after a rate limit');
    limited.context.document.querySelectorAll=()=>[{textContent:JSON.stringify({reels_media:[reel]})}];
    assert.equal((await limited.context.getStories('42')).data.reels_media[0].items.length,2);
    const failed=setup(),ui=popup(failed.context);
    failed.context.getUserId=async()=>{throw new Error('Fixture request timed out.');};
    await failed.context.onStoryAll();
    assert.match(ui.state().message,/timed out/);
    assert.equal(ui.state().disabled,true);
    assert.equal(ui.state().loading,false);
    vm.runInContext(strip(read('functions/highlight.js')),failed.context);
    failed.context.getHighlightStories=async()=>{throw new Error('Fixture Highlight request failed.');};
    await failed.context.onHighlightsStoryAll();
    assert.match(ui.state().message,/Highlight request failed/);

    const profile=setup();let fetches=0;
    profile.context.fetch=async(_url,options)=>{
        fetches++;assert.equal(options.credentials,'include');
        return {ok:true,text:async()=>'<meta property="og:image" content="photo.jpg?a=1&amp;b=2"><script>{"profile_id":"9001"}</script>'};
    };
    const user=profile.context.getUserId('ProfileFixture');
    profile.requests[0].onload({status:200,response:'not JSON'});
    assert.equal((await user).user.pk,'9001');
    assert.equal((await profile.context.getUserId('ProfileFixture')).user.profile_pic_url,'photo.jpg?a=1&b=2');
    assert.equal(fetches,1,'profile results must be cached');
    const rate=setup();rate.context.fetch=()=>{throw new Error('must not fetch after rate limit');};
    const rateUser=rate.context.getUserId('ProfileFixture');
    rate.requests[0].onload({status:429,response:'rate limited'});
    await assert.rejects(rateUser,e=>e.code==='POST_RATE_LIMITED');
    // A CDN-cached older version must never be advertised as an update.
    const general=read('utils/general.js');
    const notification=general.slice(general.indexOf('export function callNotification()'),general.indexOf('/**\n * openNewTab')).replace('export function ','function ');
    let check,notices=0;
    const updater=vm.createContext({GM_info:{script:{version:'4.3.5.1'}},logger(){},_i18n:v=>v,
        GM_xmlhttpRequest:r=>{check=r;},GM_notification:()=>{notices++;}});
    vm.runInContext(notification,updater);
    updater.callNotification();
    assert.equal(check.url,'https://raw.githubusercontent.com/ChenshuXu/ig-helper/master/ig-helper.meta.js');
    for(const version of ['4.2.1.3','4.3.5','4.3.5.1'])check.onload({responseText:'// @version '+version});
    assert.equal(notices,0);
    check.onload({responseText:'// @version 4.3.5.2'});
    assert.equal(notices,1);
    console.log('modern requests, schema normalization, popup recovery, limits, profile fallback and update checks passed');
})();
