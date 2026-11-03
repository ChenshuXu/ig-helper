const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const api = fs.readFileSync(`${__dirname}/../src/utils/api.js`, 'utf8')
    .split('/*! ESLINT IMPORT END !*/')[1].replaceAll('export function ', 'function ');

function setup() {
    const records = new Map([
        ['post', { code: 'Target', pk: '100', media_type: 8, taken_at: 50,
            user: { __ref: 'user' }, carousel_media_count: 2,
            carousel_media: { __refs: ['photo', 'video'] } }],
        ['user', { username: 'Owner' }],
        ['photo', { pk: '101', media_type: 1, original_width: 2000, original_height: 3000,
            image_versions2: { __ref: 'images' }, video_versions: null }],
        ['video', { pk: '102', media_type: 2, image_versions2: { __ref: 'images' },
            video_versions: { __refs: ['smallVideo', 'largeVideo'] } }],
        ['images', { candidates: { __refs: ['image'] } }],
        ['image', { width: 1080, height: 1440, url: 'photo.jpg' }],
        ['smallVideo', { width: 320, url: 'small.mp4' }],
        ['largeVideo', { width: 1080, url: 'large.mp4' }]
    ]);
    const source = { getRecordIDs: () => [...records.keys()], get: id => records.get(id) };
    const anchor = { __reactFiber_test: { return: { memoizedProps: {
        value: { environment: { getStore: () => ({ getSource: () => source }) } }
    } } } };
    let anchors = [anchor], scripts = [], requests = [];
    const context = vm.createContext({
        document: { querySelectorAll: selector => selector.startsWith('script') ? scripts.map(textContent => ({ textContent })) : anchors },
        logger: () => {}, getAppID: () => 'app',
        GM_xmlhttpRequest: options => requests.push(options)
    });
    vm.runInContext(api, context);
    return { context, records, requests, setAnchors: value => { anchors = value; }, setScripts: value => { scripts = value; } };
}

(async () => {
    const t = setup(), read = code => t.context.getPagePostMedia(code);
    const post = read('Target');
    assert.equal(post.carousel_media.length, 2);
    assert.equal(post.owner.username, 'Owner');
    assert.equal(post.carousel_media[0].taken_at, 50);
    assert.equal(post.carousel_media[0].original_width, 2000);
    assert.equal(post.carousel_media[0].video_versions, null);
    assert.equal(post.carousel_media[1].video_versions[0].url, 'large.mp4');
    post.carousel_media[0].image_versions2.candidates[0].url = 'changed';
    assert.equal(t.records.get('image').url, 'photo.jpg');
    assert.equal(read('Other'), null);
    assert.equal((await t.context.getBlobMedia('Target')).type, 'page');
    assert.equal(t.requests.length, 0);
    t.records.delete('video');
    assert.equal(read('Target'), null, 'missing carousel item must not enable partial downloads');
    t.records.set('video', { pk: '102', media_type: 2, image_versions2: { __ref: 'images' } });
    assert.equal(read('Target'), null, 'missing video URL must not produce an image download');
    t.records.get('post').carousel_media_count = 3;
    assert.equal(read('Target'), null);
    t.setAnchors([]);
    const single = { code: 'Single', pk: '201', media_type: 1, user: { username: 'SingleOwner' },
        image_versions2: { candidates: [{ url: 'single.jpg', width: 1000 }] } };
    t.setScripts(['Single invalid JSON', JSON.stringify({ data: { items: [single] } })]);
    assert.equal(read('Single').image_versions2.candidates[0].url, 'single.jpg');
    t.setScripts([]);
    const limited = t.context.getBlobMedia('Unknown');
    t.requests[0].onload({ status: 400, response: JSON.stringify({ status: 'fail', message: 'feedback_required', feedback_required: true }) });
    await assert.rejects(limited, error => error.code === 'POST_RATE_LIMITED');
    assert.equal(t.requests.length, 1, 'feedback_required must not trigger fallback API');
    await assert.rejects(t.context.getBlobMedia('Unknown'), error => error.code === 'POST_RATE_LIMITED');
    await assert.rejects(t.context.getBlobMediaWithQueryID('Unknown'), error => error.code === 'POST_RATE_LIMITED');
    assert.equal(t.requests.length, 1, 'reopening must not issue requests after rate limiting');
    t.setScripts([JSON.stringify(single)]);
    assert.equal((await t.context.getBlobMedia('Single')).type, 'page', 'local data remains usable while limited');
    await assert.rejects(t.context.getBlobMedia(''), /Invalid post shortcode/);
    assert.equal(t.requests.length, 1);

    const u = setup(); u.setAnchors([]);
    const fallback = u.context.getBlobMedia('Unknown');
    u.requests[0].onload({ status: 200, response: JSON.stringify({ status: 'fail', message: 'unsupported query' }) });
    assert.equal(u.requests.length, 2, 'ordinary legacy-query failures may use fallback');
    u.requests[1].onload({ status: 200, response: JSON.stringify({ data: { xdt_api__v1__media__shortcode__web_info: { items: [single] } } }) });
    assert.equal((await fallback).data.code, 'Single');
    const timeout = u.context.getBlobMedia('Timeout');
    u.requests.at(-1).ontimeout();
    await assert.rejects(timeout, /timed out/);
    const empty = u.context.getBlobMedia('Empty');
    u.requests.at(-1).onload({ status: 200, response: JSON.stringify({ data: {} }) });
    await assert.rejects(empty, /Unable to load post media/);
    const nonJSON = u.context.getBlobMedia('Limited');
    u.requests.at(-1).onload({ status: 429, response: '<html>Too many requests</html>' });
    await assert.rejects(nonJSON, error => error.code === 'POST_RATE_LIMITED');

    // Check the popup contract: errors remain visible and empty batch actions disabled.
    const postSource = fs.readFileSync(`${__dirname}/../src/functions/post.js`, 'utf8');
    const render = postSource.slice(postSource.indexOf('export async function createMediaListDOM'), postSource.indexOf('/**\n * getVisibleNodeIndex')).replace('export async', 'async');
    let message, disabled;
    const target = { find: () => ({ remove() {}, text: value => { message = value; } }), append() {} };
    const popup = vm.createContext({ $: selector => selector === 'body' ? target : { prop: (name, value) => { disabled = value; } },
        getBlobMedia: async () => { throw new Error('Instagram has temporarily limited media requests.'); }, logger() {} });
    vm.runInContext(render, popup);
    assert.equal(await popup.createMediaListDOM('Target', 'body', 'Loading'), 0);
    assert.match(message, /temporarily limited/);
    assert.equal(disabled, true);
    console.log('page post data, API rate-limit, timeout and popup failure checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
