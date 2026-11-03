import { userIdCache } from "../settings";
import { logger, getAppID, updateLoadingBar, getInstagramRequestContext } from "./general";
/*! ESLINT IMPORT END !*/

export function getPageStoryReel(identifier) {
    const matches = reel => String(identifier).startsWith('highlight:') ?
        String(reel.id) === String(identifier) : /^\d+$/.test(String(reel.id)) && (
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
    try {
        return normalizeStoryReel(reel);
    } catch (err) {
        logger('getPageStoryReel()', err.message);
        return null;
    }
}

// Keep the existing Story/Highlights contract while accepting upstream's new fields.
export function normalizeStoryReel(reel) {
    const user = reel?.user || reel?.owner;
    if (!user?.username || !Array.isArray(reel?.items) || !reel.items.length) {
        throw new Error('Instagram returned no Story or Highlight media.');
    }
    const items = reel.items.map(item => {
        const images = (item?.image_versions2?.candidates || item?.display_resources?.map(image => ({
            url: image.src, width: image.config_width
        })) || []).filter(image => image?.url).map(image => ({ ...image })).sort((a, b) => b.width - a.width);
        const videos = (item?.video_versions || item?.video_resources?.map(video => ({
            url: video.src, width: video.config_width
        })) || []).filter(video => video?.url).map(video => ({ ...video })).sort((a, b) => b.width - a.width);
        const mediaType = item?.media_type ?? (item?.is_video || videos.length ? 2 : 1);
        const id = item?.pk ?? item?.id?.split('_')[0];
        if (!id || !images.length || ![1, 2].includes(mediaType) || (mediaType === 2 && !videos.length)) {
            throw new Error('Instagram returned incomplete Story or Highlight media. Refresh the page and try again.');
        }
        return {
            ...item,
            id: String(id),
            media_type: mediaType,
            is_video: mediaType === 2,
            taken_at_timestamp: item.taken_at_timestamp ?? item.taken_at,
            image_versions2: { candidates: images },
            video_versions: mediaType === 2 ? videos : null,
            display_url: images[0].url,
            display_resources: images.map(image => ({ src: image.url, config_width: image.width })),
            video_resources: videos.map(video => ({ src: video.url, config_width: video.width }))
        };
    });
    return { ...reel, user: { ...user }, owner: { ...user }, items };
}

/**
 * getHighlightStories
 * @description Get a list of all stories in highlight Id.
 *
 * @param  {Integer}  highlightId
 * @return {Object}
 */
export async function getHighlightStories(highlightId) {
    if (!/^\d+$/.test(String(highlightId))) throw new Error('Invalid Highlight ID.');
    const identifier = `highlight:${highlightId}`;
    const loaded = getPageStoryReel(identifier);
    if (loaded) return { data: { reels_media: [loaded] } };
    const data = await requestInstagramGraphQL({
        friendlyName: 'PolarisStoriesV3HighlightsPageQuery',
        rootField: 'xdt_api__v1__feed__reels_media__connection',
        docID: '29299425373007309',
        variables: { initial_reel_id: identifier, reel_ids: [identifier], first: 999, last: 0,
            __relay_internal__pv__PolarisCommunityNoteStoriesLabelEnabledrelayprovider: true }
    });
    const connection = data.xdt_api__v1__feed__reels_media__connection;
    if (connection?.page_info?.has_next_page) throw new Error('Instagram returned an incomplete Highlight.');
    const reel = connection?.edges?.map(edge => edge.node).find(node => String(node?.id) === identifier);
    return { data: { reels_media: [normalizeStoryReel(reel)] } };
}

/**
 * getStories
 * @description Get a list of all stories in user Id.
 *
 * @param  {Integer}  userId
 * @return {Object}
 */
export async function getStories(userId) {
    if (!/^\d+$/.test(String(userId))) throw new Error('Invalid Story user ID.');
    const reel = getPageStoryReel(userId);
    if (reel) return { data: { reels_media: [reel] } };
    const data = await requestInstagramGraphQL({
        friendlyName: 'PolarisStoriesV3ReelPageStandaloneQuery',
        rootField: 'xdt_api__v1__feed__reels_media',
        docID: '29170422829314651',
        variables: { reel_ids_arr: [String(userId)],
            __relay_internal__pv__PolarisCommunityNoteStoriesLabelEnabledrelayprovider: true }
    });
    const result = data.xdt_api__v1__feed__reels_media?.reels_media?.find(item => String(item.id) === String(userId));
    return { data: { reels_media: [normalizeStoryReel(result)] } };
}

// Upstream 4.3.5's profile-page fallback, with a bounded request and rate-limit handling.
export async function getUserIdViaProfileHtml(username) {
    if (postRequestsLimited) throw postRequestError({ status: 429 });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
        const response = await fetch(`https://www.instagram.com/${encodeURIComponent(username)}/`, {
            credentials: 'include', headers: { Accept: 'text/html' }, signal: controller.signal
        });
        if (!response.ok) throw postRequestError(response);
        const html = await response.text();
        const patterns = [/"profile_id":"(\d+)"/, /"page_id":"profilePage_(\d+)"/, /instapp:owner_user_id"\s+content="(\d+)"/];
        const id = patterns.map(pattern => html.match(pattern)?.[1]).find(Boolean);
        if (!id) throw new Error('Instagram profile page did not contain a user ID.');
        const image = html.match(/property="og:image"\s+content="([^"]+)"/)?.[1]?.replaceAll('&amp;', '&') || null;
        return { user: { id, pk: id, username, profile_pic_url: image } };
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * getUserId
 * @description Get user's id with username.
 *
 * @param  {String}  username
 * @return {Promise<Integer>}
 */
export async function getUserId(username) {
    if (!username || !/^[\w.]+$/.test(username)) throw new Error('Invalid Instagram username.');
    const reel = getPageStoryReel(username);
    if (reel?.user) return { user: { ...reel.user, pk: reel.id } };
    if (userIdCache.has(username)) return userIdCache.get(username);
    if (postRequestsLimited) throw postRequestError({ status: 429 });
    let result;
    try {
        result = await new Promise((resolve, reject) => GM_xmlhttpRequest({
            method: 'GET',
            url: `https://www.instagram.com/web/search/topsearch/?query=${encodeURIComponent(username)}`,
            timeout: 20000,
            ontimeout: () => reject(new Error('User lookup timed out.')),
            onerror: () => reject(new Error('User lookup failed.')),
            onload(response) {
                try {
                    if (response.status === 429) throw postRequestError(response);
                    const obj = JSON.parse(response.response);
                    const error = postRequestError(response, obj);
                    if (error.code === 'POST_RATE_LIMITED') throw error;
                    const match = obj.users?.find(entry => entry.user?.username?.toLowerCase() === username.toLowerCase());
                    resolve(match?.user?.pk || match?.user?.id ? {
                        user: { ...match.user, pk: match.user.pk ?? match.user.id }
                    } : null);
                } catch (err) {
                    reject(err);
                }
            }
        }));
    } catch (err) {
        if (err.code === 'POST_RATE_LIMITED') throw err;
        logger('getUserId()', err.message);
    }
    if (!result) result = await getUserIdViaProfileHtml(username);
    userIdCache.set(username, result);
    return result;
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

function normalizePostMedia(post, shortcode) {
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
}

// Read media already fetched by Instagram instead of issuing another GraphQL request.
export function getPagePostMedia(shortcode) {
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
                    const post = normalizePostMedia({
                        ...expand(record),
                        user: read(record.user),
                        carousel_media: record.carousel_media ? readList(record.carousel_media).map(expand) : null
                    }, shortcode);
                    if (post) return post;
                }
            }
            fiber = fiber.return;
        }
    }

    // Full page loads may also include an unnormalized response in embedded JSON.
    const findPost = value => {
        if (!value || typeof value !== 'object') return null;
        const post = normalizePostMedia(value, shortcode);
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
        `Unable to load post media: ${body?.message || body?.errors?.[0]?.message || `HTTP ${response.status}`}`);
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
export async function getBlobMedia(postPath) {
    if (!postPath || !/^[\w-]+$/.test(postPath)) throw new Error('Invalid post shortcode.');
    const post = getPagePostMedia(postPath);
    if (post) return { type: 'page', data: post };
    const data = await getBlobMediaWithQueryID(postPath);
    const media = normalizePostMedia(data.xdt_api__v1__media__shortcode__web_info?.items?.[0], postPath);
    if (!media) throw new Error('Unable to load post media: Instagram returned incomplete media.');
    return { type: 'query_id', data: media };
}

export function getBlobMediaWithQueryID(postPath) {
    if (!postPath || !/^[\w-]+$/.test(postPath)) return Promise.reject(new Error('Invalid post shortcode.'));
    return requestInstagramGraphQL({
        friendlyName: 'PolarisPostRootQuery',
        rootField: 'xdt_api__v1__media__shortcode__web_info',
        docID: '39422285384081769',
        variables: { shortcode: postPath,
            __relay_internal__pv__PolarisShortDramaEnabledrelayprovider: true,
            __relay_internal__pv__PolarisThreadsStyleCommentsEnabledrelayprovider: false,
            __relay_internal__pv__PolarisMultiCaptionCarouselEnabledrelayprovider: true }
    });
}

// The doc IDs and request fields follow upstream 4.3.5; local media always takes priority.
function requestInstagramGraphQL({ friendlyName, rootField, docID, variables }) {
    if (postRequestsLimited) return Promise.reject(postRequestError({ status: 429 }));
    return new Promise((resolve, reject) => {
        const context = getInstagramRequestContext();
        if (!context.dtsg || !context.lsd) {
            throw new Error('Instagram request data is unavailable. Refresh Instagram and try again.');
        }
        const data = new FormData();
        const site = context.siteData;
        const fields = {
            av: context.userID, fb_api_caller_class: 'RelayModern', fb_api_req_friendly_name: friendlyName,
            server_timestamps: 'true', doc_id: docID, lsd: context.lsd, fb_dtsg: context.dtsg,
            __hs: site.haste_session, __hsi: site.hsi, __rev: site.client_revision,
            __spin_r: site.__spin_r, __spin_b: site.__spin_b, __spin_t: site.__spin_t,
            __comet_req: site.comet_env, __ccg: 'EXCELLENT', dpr: site.pr,
            jazoest: '2' + [...context.dtsg].reduce((sum, char) => sum + char.charCodeAt(0), 0),
            __user: '0', __a: '1', __d: 'www', __req: '1',
            __crn: friendlyName === 'PolarisPostRootQuery' ? 'comet.igweb.PolarisFeedRoute' : 'comet.igweb.PolarisProfilePostsTabRoute',
            __s: Array.from({ length: 3 }, () => Math.floor(Math.random() * 2 ** 31).toString(36).padStart(6, '0')).join(':'),
            variables: JSON.stringify(variables)
        };
        for (const [key, value] of Object.entries(fields)) if (value != null) data.append(key, String(value));
        GM_xmlhttpRequest({
            method: 'POST', url: 'https://www.instagram.com/graphql/query', data,
            headers: {
                'X-IG-App-ID': context.appID || '0', 'X-CSRFToken': context.csrfToken,
                'X-Fb-Friendly-Name': friendlyName, 'X-Fb-Lsd': context.lsd,
                ...(context.bloksVersion ? { 'X-Bloks-Version-ID': context.bloksVersion } : {}),
                'X-Root-Field-Name': rootField, 'X-Asbd-ID': '359341'
            },
            timeout: 20000,
            ontimeout: () => reject(new Error('Media request timed out. Please try again later.')),
            onerror: () => reject(new Error('Unable to load media. Check your connection and try again.')),
            onload(response) {
                try {
                    if (response.status === 429) throw postRequestError(response);
                    const obj = JSON.parse(response.response);
                    const error = postRequestError(response, obj);
                    if (error.code === 'POST_RATE_LIMITED' || response.status >= 400 || obj.status === 'fail' || obj.errors?.length) throw error;
                    if (!obj.data) throw new Error('Instagram returned no media data.');
                    resolve(obj.data);
                } catch (err) {
                    reject(err);
                }
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
