const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(`${__dirname}/../src/utils/api.js`, 'utf8');
const helper = source.slice(source.indexOf('export function getPageStoryReel'), source.indexOf('/**'))
    .replace('export function', 'function');
let scripts = [];
const context = vm.createContext({
    document: { querySelector: () => null, querySelectorAll: () => scripts.map(textContent => ({ textContent })) },
    logger: () => {}
});
vm.runInContext(helper, context);
const read = identifier => context.getPageStoryReel(identifier);
const reel = {
    id: '16951213165', user: { username: 'StoryOwner' }, items: [{
        id: '4014674013674183708_16951213165', pk: '4014674013674183708',
        media_type: 2, taken_at: 1792806455,
        image_versions2: { candidates: [{ url: 'small.jpg', width: 320 }, { url: 'large.jpg', width: 1080 }] },
        video_versions: [{ url: 'small.mp4', width: 320 }, { url: 'large.mp4', width: 1080 }]
    }, {
        id: '4014713446901356732_16951213165', media_type: 1, taken_at: 1792811157,
        image_versions2: { candidates: [{ url: 'photo.jpg', width: 1080 }] }
    }]
};
scripts = ['reels_media invalid JSON', JSON.stringify({ require: [[{ __bbox: { result: {
    data: { xdt_api__v1__feed__reels_media: { reels_media: [reel] } }
} } }]] })];
const actual = read('storyowner');
assert.equal(actual.items.length, 2);
assert.equal(actual.items[0].id, '4014674013674183708');
assert.equal(actual.items[0].video_resources[0].src, 'large.mp4');
assert.equal(actual.items[0].display_resources[0].src, 'large.jpg');
assert.equal(actual.items[0].taken_at_timestamp, 1792806455);
assert.equal(actual.items[0].is_video, true);
assert.equal(actual.items[1].is_video, false);
assert.equal(actual.items[1].id, '4014713446901356732');
assert.equal(actual.items[1].display_url, 'photo.jpg');
assert.equal(read('16951213165').user.username, 'StoryOwner');
assert.equal(read('otherowner'), null);
assert.equal(reel.items[0].video_versions[0].url, 'small.mp4');
scripts = [];
assert.equal(read('16951213165'), null);

// A Story loaded through in-app navigation exists only in the live Relay store.
const records = new Map([
    ['XDTReelDict:42', { id: '42', user: { __ref: 'user' }, items: { __refs: ['media'] } }],
    ['user', { username: 'NextOwner' }],
    ['media', { pk: '4014713446901356733', media_type: 2, taken_at: 10,
        image_versions2: { __ref: 'images' }, video_versions: { __refs: ['video'] } }],
    ['images', { candidates: { __refs: ['image'] } }],
    ['image', { url: 'next.jpg', width: 1080 }],
    ['video', { url: 'next.mp4', width: 1080 }]
]);
const environment = { getStore: () => ({ getSource: () => ({
    get: id => records.get(id), getRecordIDs: () => [...records.keys()]
}) }) };
context.document.querySelector = () => ({ __reactFiber_test: {
    return: { memoizedProps: { value: { environment } } }
} });
assert.equal(read('nextowner').items[0].video_resources[0].src, 'next.mp4');
assert.equal(read('42').items[0].display_url, 'next.jpg');
assert.equal(read('16951213165'), null);
records.set('XDTReelDict:highlight:1', {
    id: 'highlight:1', user: { __ref: 'highlight-user' }, items: { __refs: ['media'] }
});
records.set('highlight-user', { username: 'HighlightOwner' });
assert.equal(read('HighlightOwner'), null);
records.get('XDTReelDict:42').items.__refs.push('photo');
records.set('photo', { pk: '4014713446901356734', media_type: 1, taken_at: 11,
    image_versions2: { __ref: 'images' }, video_versions: null });
assert.equal(read('42').items[1].video_versions, null);
assert.equal(read('42').items[1].is_video, false);
records.get('video').url = 'updated.mp4';
assert.equal(read('42').items[0].video_resources[0].src, 'updated.mp4');
console.log('page Story data checks passed');
