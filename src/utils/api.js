import { userIdCache } from "../settings";
import { logger, getAppID, updateLoadingBar } from "./general";
/*! ESLINT IMPORT END !*/

export function getPageStoryReel(identifier) {
    const matches = reel => /^\d+$/.test(String(reel.id)) && (
        String(reel.id) === String(identifier) ||
        reel.user?.username?.toLowerCase() === String(identifier).toLowerCase()
    );
    function findReel(value) {
        if (!value || typeof value !== 'object') return null;
        if (Array.isArray(value.reels_media)) {
            const reel = value.reels_media.find(matches);
            if (reel) return reel;
        }
        for (const child of Object.values(value)) {
            const reel = findReel(child);
            if (reel) return reel;
        }
        return null;
    }

    let reel = null;
    // Read the live Relay store so navigation between Stories needs no API request.
    const anchor = document.querySelector('section a[href]');
    let fiber = anchor?.[Object.keys(anchor).find(key => key.startsWith('__reactFiber'))];
    while (fiber) {
        const environment = fiber.memoizedProps?.value?.environment;
        if (typeof environment?.getStore === 'function') {
            const source = environment.getStore().getSource();
            const read = link => link?.__ref ? source.get(link.__ref) : null;
            const readList = link => (link?.__refs || []).map(id => source.get(id)).filter(Boolean);
            for (const id of source.getRecordIDs()) {
                if (!id.startsWith('XDTReelDict:')) continue;
                const record = source.get(id);
                const user = read(record?.user);
                if (!record || !matches({ ...record, user })) continue;
                const items = readList(record.items).map(item => {
                    const images = read(item.image_versions2);
                    return {
                        ...item,
                        image_versions2: { candidates: readList(images?.candidates) },
                        video_versions: item.video_versions ? readList(item.video_versions) : null
                    };
                });
                if (items.length && items.every(item => item.image_versions2.candidates.length &&
                    (item.media_type !== 2 || item.video_versions?.length))) {
                    reel = { ...record, user, items };
                }
                break;
            }
            break;
        }
        fiber = fiber.return;
    }

    // Server-rendered pages also carry the original, unnormalized Story response.
    if (!reel) for (const script of document.querySelectorAll('script[type="application/json"]')) {
        if (!script.textContent.includes('reels_media')) continue;
        let data;
        try {
            data = JSON.parse(script.textContent);
        } catch (err) {
            logger('getPageStoryReel()', 'invalid page JSON', err.message);
            continue;
        }
        reel = findReel(data);
        if (reel && Array.isArray(reel.items)) break;
        reel = null;
    }
    if (!reel) return null;
    const items = reel.items.map(item => {
        const images = [...(item.image_versions2?.candidates || [])]
            .sort((a, b) => b.width - a.width);
        const videos = [...(item.video_versions || [])]
            .sort((a, b) => b.width - a.width);
        return {
            ...item,
            id: String(item.pk ?? item.id.split('_')[0]),
            is_video: item.media_type === 2,
            taken_at_timestamp: item.taken_at,
            display_url: images[0]?.url,
            display_resources: images.map(image => ({ src: image.url, config_width: image.width })),
            video_resources: videos.map(video => ({ src: video.url, config_width: video.width }))
        };
    });
    return { ...reel, items };
}

/**
 * getHighlightStories
 * @description Get a list of all stories in highlight Id.
 *
 * @param  {Integer}  highlightId
 * @return {Object}
 */
export function getHighlightStories(highlightId) {
    return new Promise((resolve, reject) => {
        const getURL = `https://www.instagram.com/graphql/query/?query_hash=45246d3fe16ccc6577e0bd297a5db1ab&variables=%7B%22highlight_reel_ids%22:%5B%22${highlightId}%22%5D,%22precomposed_overlay%22:false%7D`;

        GM_xmlhttpRequest({
            method: "GET",
            url: getURL,
            onload: function (response) {
                try {
                    let obj = JSON.parse(response.response);
                    resolve(obj);
                }
                catch (err) {
                    logger('getHighlightStories()', 'reject', err.message);
                    reject(err);
                }
            },
            onerror: function (err) {
                logger('getHighlightStories()', 'reject', err);
                reject(err);
            }
        });
    });
}

/**
 * getStories
 * @description Get a list of all stories in user Id.
 *
 * @param  {Integer}  userId
 * @return {Object}
 */
export function getStories(userId) {
    const reel = getPageStoryReel(userId);
    if (reel) return Promise.resolve({ data: { reels_media: [reel] } });
    return new Promise((resolve, reject) => {
        const getURL = `https://www.instagram.com/graphql/query/?query_hash=15463e8449a83d3d60b06be7e90627c7&variables=%7B%22reel_ids%22:%5B%22${userId}%22%5D,%22precomposed_overlay%22:false%7D`;

        GM_xmlhttpRequest({
            method: "GET",
            url: getURL,
            onload: function (response) {
                try {
                    let obj = JSON.parse(response.response);
                    logger('getStories()', obj);
                    resolve(obj);
                }
                catch (err) {
                    logger('getStories()', 'reject', err.message);
                    reject(err);
                }
            },
            onerror: function (err) {
                logger('getStories()', 'reject', err);
                reject(err);
            }
        });
    });
}

/**
 * getUserId
 * @description Get user's id with username.
 *
 * @param  {String}  username
 * @return {Promise<Integer>}
 */
export function getUserId(username) {
    const reel = getPageStoryReel(username);
    if (reel?.user) return Promise.resolve({ user: { ...reel.user, pk: reel.id } });
    return new Promise((resolve, reject) => {
        if (userIdCache.has(username)) {
            logger('getUserId()', 'return from cache:', userIdCache.get(username));
            resolve(userIdCache.get(username));
            return;
        }

        let getURL = `https://www.instagram.com/web/search/topsearch/?query=${username}`;

        GM_xmlhttpRequest({
            method: "GET",
            url: getURL,
            onload: function (response) {
                try {
                    // Fix search issue by Discord: sno_w_
                    let obj = JSON.parse(response.response);
                    let result = null;
                    (obj.users ?? []).forEach(pos => {
                        if (pos.user.username?.toLowerCase() === username?.toLowerCase()) {
                            result = pos;
                        }
                    });

                    if (result != null) {
                        logger('getUserId()', result);
                        userIdCache.set(username, result);
                        resolve(result);
                    }
                    else {
                        getUserIdWithAgent(username).then((result) => {
                            userIdCache.set(username, result);
                            resolve(result);
                        // eslint-disable-next-line no-unused-vars
                        }).catch((err) => {
                            userIdCache.delete(username);
                            logger('getUserId()', 'fallback reject', err);
							alert("Cannot find user info from getUserId()\nDetails may be in the console.");
                            reject(err);
                        });
                    }
                } catch (err) {
                    userIdCache.delete(username);
                    logger('getUserId()', 'parse reject', err);
                    reject(err);
                }
            },
            onerror: function (err) {
                logger('getUserId()', 'reject', err);
                userIdCache.delete(username);
                reject(err);
            }
        });
    });
}

/**
 * getUserIdWithAgent
 * @description Get user's id with username.
 *
 * @param  {String}  username
 * @return {Integer}
 */
export function getUserIdWithAgent(username) {
    return new Promise((resolve, reject) => {
        const getURL = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${username}`;

        GM_xmlhttpRequest({
            method: "GET",
            url: getURL,
            headers: {
                'X-IG-App-ID': getAppID()
            },
            onload: function (response) {
                try {
                    let obj = JSON.parse(response.response);
                    let hasUser = obj?.data?.user;

                    if (hasUser != null) {
                        let userInfo = obj?.data;
                        userInfo.user.pk = userInfo.user.id;
                        logger('getUserIdWithAgent()', obj);
                        resolve(userInfo);
                    }
                    else {
                        logger('getUserIdWithAgent()', 'reject', 'undefined');
                        reject('undefined');
                    }
                }
                catch (err) {
                    logger('getUserIdWithAgent()', 'reject', err.message);
                    reject(err);
                }
            },
            onerror: function (err) {
                logger('getUserIdWithAgent()', 'reject', err);
                reject(err);
            }
        });
    });
}

/**
 * getUserHighSizeProfile
 * @description Get user's high quality avatar image.
 *
 * @param  {Integer}  userId
 * @return {String}
 */
export function getUserHighSizeProfile(userId) {
    return new Promise((resolve, reject) => {
        const getURL = `https://www.instagram.com/api/v1/users/${userId}/info/`;

        GM_xmlhttpRequest({
            method: "GET",
            url: getURL,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Linux; Android 10; Pixel 7 XL)Build/RP1A.20845.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/5.0 Chrome/117.0.5938.60 Mobile Safari/537.36 Instagram 307.0.0.34.111'
            },
            onload: function (response) {
                try {
                    let obj = JSON.parse(response.response);
                    if (obj.status !== 'ok') {
                        logger('getUserHighSizeProfile()', 'reject', obj);
                        reject('faild');
                    }
                    else {
                        logger('getUserHighSizeProfile()', obj);
                        resolve(obj.user.hd_profile_pic_url_info?.url);
                    }
                }
                catch (err) {
                    logger('getUserHighSizeProfile()', 'reject', err);
                    reject(err);
                }
            },
            onerror: function (err) {
                logger('getUserHighSizeProfile()', 'reject', err);
                reject(err);
            }
        });
    });
}

/**
 * getPostOwner
 * @description Get post's author with post shortcode.
 *
 * @param  {String}  postPath
 * @return {String}
 */
export function getPostOwner(postPath) {
    return new Promise((resolve, reject) => {
        if (!postPath) reject("NOPATH");
        const postShortCode = postPath;
        const getURL = `https://www.instagram.com/graphql/query/?query_hash=2c4c2e343a8f64c625ba02b2aa12c7f8&variables=%7B%22shortcode%22:%22${postShortCode}%22}`;

        GM_xmlhttpRequest({
            method: "GET",
            url: getURL,
            onload: function (response) {
                try {
                    let obj = JSON.parse(response.response);
                    logger('getPostOwner()', obj);
                    resolve(obj.data.shortcode_media.owner.username);
                }
                catch (err) {
                    logger('getPostOwner()', 'reject', err.message);
                    reject(err);
                }
            },
            onerror: function (err) {
                logger('getPostOwner()', 'reject', err);
                reject(err);
            }
        });
    });
}

// Read media already fetched by Instagram instead of issuing another GraphQL request.
export function getPagePostMedia(shortcode) {
    const normalize = post => {
        if (post?.code !== shortcode || !post.user?.username) return null;
        const media = post.media_type === 8 ? post.carousel_media : [post];
        if (!Array.isArray(media) || !media.length ||
            (post.media_type === 8 && (!post.carousel_media_count || media.length !== post.carousel_media_count))) return null;
        if (!media.every(item => item?.pk && item.image_versions2?.candidates?.some(image => image?.url) &&
            (item.media_type === 1 || (item.media_type === 2 && item.video_versions?.some(video => video?.url))))) return null;
        const normalizeItem = item => ({
            ...item,
            taken_at: item.taken_at ?? post.taken_at,
            image_versions2: { candidates: item.image_versions2.candidates.filter(image => image?.url).map(image => ({ ...image })) },
            video_versions: item.media_type === 2 ? item.video_versions.filter(video => video?.url)
                .map(video => ({ ...video })).sort((a, b) => b.width - a.width) : null
        });
        return {
            ...post,
            user: { ...post.user },
            owner: { ...post.user },
            ...(post.media_type === 8 ? { carousel_media: media.map(normalizeItem) } : normalizeItem(post))
        };
    };

    const anchors = document.querySelectorAll(`a[href*="/${shortcode}/"], section a[href], main a[href]`);
    const environments = new Set();
    for (const anchor of anchors) {
        let fiber = anchor[Object.keys(anchor).find(key => key.startsWith('__reactFiber'))];
        while (fiber) {
            const environment = fiber.memoizedProps?.value?.environment;
            if (typeof environment?.getStore === 'function' && !environments.has(environment)) {
                environments.add(environment);
                const source = environment.getStore().getSource();
                const read = link => link?.__ref ? source.get(link.__ref) : null;
                const readList = link => (link?.__refs || []).map(id => source.get(id));
                const expand = record => {
                    if (!record) return null;
                    const images = read(record.image_versions2);
                    return {
                        ...record,
                        image_versions2: { candidates: readList(images?.candidates) },
                        video_versions: record.video_versions ? readList(record.video_versions) : null
                    };
                };
                for (const id of source.getRecordIDs()) {
                    const record = source.get(id);
                    if (record?.code !== shortcode) continue;
                    const post = normalize({
                        ...expand(record),
                        user: read(record.user),
                        carousel_media: record.carousel_media ? readList(record.carousel_media).map(expand) : null
                    });
                    if (post) return post;
                }
            }
            fiber = fiber.return;
        }
    }

    // Full page loads may also include an unnormalized response in embedded JSON.
    const findPost = value => {
        if (!value || typeof value !== 'object') return null;
        const post = normalize(value);
        if (post) return post;
        for (const child of Object.values(value)) {
            const found = findPost(child);
            if (found) return found;
        }
        return null;
    };
    for (const script of document.querySelectorAll('script[type="application/json"]')) {
        if (!script.textContent.includes(shortcode)) continue;
        let data;
        try {
            data = JSON.parse(script.textContent);
        } catch (err) {
            logger('getPagePostMedia()', 'invalid page JSON', err.message);
            continue;
        }
        const post = findPost(data);
        if (post) return post;
    }
    return null;
}

let postRequestsLimited = false;

function postRequestError(response, body) {
    const limited = response.status === 429 || body?.feedback_required === true ||
        ['feedback_required', 'rate_limit_error', 'sentry_block'].includes(body?.message);
    const error = new Error(limited ?
        'Instagram has temporarily limited media requests. Extra requests are paused for this page; already loaded posts can still be downloaded.' :
        `Unable to load post media: ${body?.message || `HTTP ${response.status}`}`);
    error.code = limited ? 'POST_RATE_LIMITED' : 'POST_REQUEST_FAILED';
    if (limited) postRequestsLimited = true;
    return error;
}


/**
 * getBlobMedia
 * @description Get list of all media files in post with post shortcode.
 *
 * @param  {String}  postPath
 * @return {Object}
 */
export function getBlobMedia(postPath) {
    if (!postPath || !/^[\w-]+$/.test(postPath)) return Promise.reject(new Error('Invalid post shortcode.'));
    const post = getPagePostMedia(postPath);
    if (post) return Promise.resolve({ type: 'page', data: post });
    if (postRequestsLimited) return Promise.reject(postRequestError({ status: 429 }));
    return new Promise((resolve, reject) => {
        const postShortCode = postPath;
        const getURL = `https://www.instagram.com/graphql/query/?query_hash=2c4c2e343a8f64c625ba02b2aa12c7f8&variables=%7B%22shortcode%22:%22${postShortCode}%22}`;

        GM_xmlhttpRequest({
            method: "GET",
            url: getURL,
            headers: {
                "User-Agent": "Mozilla/5.0 (Linux; Android 10; Pixel 7 XL)Build/RP1A.20845.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/5.0 Chrome/117.0.5938.60 Mobile Safari/537.36 Instagram 307.0.0.34.111"
            },
            timeout: 20000,
            ontimeout: () => reject(new Error('Post media request timed out. Please try again later.')),
            onload: function (response) {
                try {
                    if (response.status === 429) throw postRequestError(response);
                    let obj = JSON.parse(response.response);
                    if (response.status === 429 || obj.feedback_required ||
                        ['feedback_required', 'rate_limit_error', 'sentry_block'].includes(obj.message)) {
                        reject(postRequestError(response, obj));
                        return;
                    }

                    if (obj.status === 'fail') {
                        logger('Request with:', 'getBlobMediaWithQuery()', postShortCode);
                        getBlobMediaWithQueryID(postShortCode).then((res) => {
                            const media = res?.xdt_api__v1__media__shortcode__web_info?.items?.[0];
                            if (!media) throw new Error('Instagram returned no post media.');
                            resolve({ type: 'query_id', data: media });
                        }).catch((err) => {
                            reject(err);
                        })
                    }
                    else {
                        if (!obj.data?.shortcode_media) throw postRequestError(response, obj);
                        resolve({ type: 'query_hash', data: obj.data });
                    }
                }
                catch (err) {
                    logger('getBlobMedia()', 'reject', err.message);
                    reject(err);
                }
            },
            onerror: function (err) {
                logger('getBlobMedia()', 'reject', err);
                reject(err);
            }
        });
    });
}

/**
 * getBlobMediaWithQueryID
 * @description Get list of all media files in post with post shortcode.
 *
 * @param  {String}  postPath
 * @return {Object}
 */
export function getBlobMediaWithQueryID(postPath) {
    if (!postPath || !/^[\w-]+$/.test(postPath)) return Promise.reject(new Error('Invalid post shortcode.'));
    if (postRequestsLimited) return Promise.reject(postRequestError({ status: 429 }));
    return new Promise((resolve, reject) => {
        const postShortCode = postPath;
        const getURL = `https://www.instagram.com/graphql/query/?query_id=9496392173716084&variables={%22shortcode%22:%22${postShortCode}%22,%22__relay_internal__pv__PolarisFeedShareMenurelayprovider%22:true,%22__relay_internal__pv__PolarisIsLoggedInrelayprovider%22:true}`;

        GM_xmlhttpRequest({
            method: "GET",
            url: getURL,
            headers: {
                "User-Agent": "Mozilla/5.0 (Linux; Android 10; Pixel 7 XL)Build/RP1A.20845.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/5.0 Chrome/117.0.5938.60 Mobile Safari/537.36 Instagram 307.0.0.34.111",
                'X-IG-App-ID': getAppID()
            },
            timeout: 20000,
            ontimeout: () => reject(new Error('Post media request timed out. Please try again later.')),
            onload: function (response) {
                try {
                    if (response.status === 429) throw postRequestError(response);
                    let obj = JSON.parse(response.response);
                    if (response.status === 429 || obj.feedback_required ||
                        ['feedback_required', 'rate_limit_error', 'sentry_block'].includes(obj.message)) {
                        reject(postRequestError(response, obj));
                        return;
                    }

                    if (obj.status === 'fail') {
                        reject(postRequestError(response, obj));
                    }
                    else {
                        if (!obj.data) throw postRequestError(response, obj);
                        resolve(obj.data);
                    }
                }
                catch (err) {
                    logger('getBlobMediaWithQueryID()', 'reject', err.message);
                    reject(err);
                }
            },
            onerror: function (err) {
                logger('getBlobMediaWithQueryID()', 'reject', err);
                reject(err);
            }
        });
    });
}

/**
 * getMediaInfo
 * @description Get Instagram Media object.
 *
 * @param  {String}  mediaId
 * @return {Object}
 */
export function getMediaInfo(mediaId) {
    return new Promise((resolve, reject) => {
        const getURL = `https://i.instagram.com/api/v1/media/${mediaId}/info/`;

        if (mediaId == null) {
            alert("Cannot call Media API because of the media id is invalid.");
            logger('getMediaInfo()', 'reject', 'Cannot call Media API because of the media id is invalid.');

            updateLoadingBar(false);
            reject(-1);
            return;
        }
        if (getAppID() == null) {
            alert("Cannot call Media API because of the app id is invalid.");
            logger('getMediaInfo()', 'reject', 'Cannot call Media API because of the app id is invalid.');
            updateLoadingBar(false);
            reject(-1);
            return;
        }

        GM_xmlhttpRequest({
            method: "GET",
            url: getURL,
            headers: {
                "User-Agent": window.navigator.userAgent,
                "Accept": "*/*",
                'X-IG-App-ID': getAppID()
            },
            onload: function (response) {
                if (response.finalUrl == getURL) {
                    let obj = JSON.parse(response.response);
                    logger('getMediaInfo()', obj);
                    resolve(obj);
                }
                else {
                    let finalURL = new URL(response.finalUrl);
                    if (finalURL.pathname.startsWith('/accounts/login')) {
                        logger('getMediaInfo()', 'reject', 'The account must be logged in to access Media API.');
                        alert("The account must be logged in to access Media API.");
                    }
                    else {
                        logger('getMediaInfo()', 'reject', 'Unable to retrieve content because the API was redirected to "' + response.finalUrl + '"');
                        alert('Unable to retrieve content because the API was redirected to "' + response.finalUrl + '"');
                    }
                    updateLoadingBar(false);
                    reject(-1);
                }
            },
            onerror: function (err) {
                logger('getMediaInfo()', 'reject', err);
                resolve(err);
            }
        });
    });
}
