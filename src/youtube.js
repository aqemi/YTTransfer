import { google } from 'googleapis';
import { backOff } from 'exponential-backoff';
import chalk from 'chalk';

const BACKOFF_OPTIONS = {
  numOfAttempts: 5,
  maxDelay: 30_000,
  startingDelay: 1_000,
  timeMultiple: 2,
  retry: (err, attemptNumber) => {
    const status = err?.response?.status ?? err?.status ?? err?.code;
    const reason = err?.response?.data?.error?.errors?.[0]?.reason ?? err?.response?.data?.error?.status ?? '';
    if (status === 403 && reason === 'quotaExceeded') {
      handleRateLimit();
      return false;
    }
    if (status === 401) {
      if (reason === 'youtubeSignupRequired') {
        console.error(chalk.red.bold('\n[NO YOUTUBE CHANNEL] This Google account has no YouTube channel.'));
        console.error(chalk.red('Visit https://www.youtube.com and create a channel, then try again.'));
      } else {
        console.error(
          chalk.red.bold(`\n[AUTH ERROR] YouTube API returned 401 Unauthorized${reason ? ` (${reason})` : ''}.`),
        );
        console.error(chalk.red('Your token has expired or been revoked. Re-authenticate and try again:'));
        console.error(chalk.yellow('  yttransfer login source'));
        console.error(chalk.yellow('  yttransfer login dest'));
      }
      process.exit(1);
    }
    const shouldRetry = (typeof status === 'number' && status >= 500) || !err?.response;
    if (shouldRetry) {
      console.log(chalk.yellow(`  ↻ Retry attempt ${attemptNumber}: ${formatApiError(err)}`));
    }
    return shouldRetry;
  },
};

export function formatApiError(err) {
  const status = err?.response?.status ?? err?.status;
  const body = err?.response?.data;
  const message = body?.error?.message ?? err.message;
  const errors = body?.error?.errors;

  if (!err?.response) {
    const code = err?.code ?? err?.cause?.code ?? 'unknown';
    return `Network error [${code}]: ${message}`;
  }

  let out = `HTTP ${status ?? 'unknown'}: ${message}`;
  if (errors?.length) {
    out += '\n    ' + errors.map((e) => `${e.reason}: ${e.message}`).join('\n    ');
  }
  return out;
}

function handleRateLimit() {
  console.error(chalk.red.bold('\n[RATE LIMITED] YouTube API quota exceeded'));
  console.error(
    chalk.red('Your daily quota has been used up. Please wait until midnight Pacific Time for it to reset.'),
  );
  console.error(
    chalk.red('Check your quota at: https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas'),
  );
  process.exit(1);
}

function yt(auth) {
  return google.youtube({ version: 'v3', auth });
}

async function fetchAllPages(apiFn, params) {
  const items = [];
  let pageToken;

  do {
    const response = await backOff(() => apiFn({ ...params, ...(pageToken ? { pageToken } : {}) }), BACKOFF_OPTIONS);
    const page = response.data.items ?? [];
    items.push(...page);
    pageToken = response.data.nextPageToken;
  } while (pageToken);

  return items;
}

export async function getLikedVideos(auth) {
  const youtube = yt(auth);
  const items = await fetchAllPages((params) => youtube.videos.list(params), {
    part: 'snippet',
    myRating: 'like',
    maxResults: 50,
  });
  return items.map((item) => ({
    videoId: item.id,
    title: item.snippet.title,
    channelTitle: item.snippet.channelTitle,
  }));
}

export async function getSubscriptions(auth) {
  const youtube = yt(auth);
  const items = await fetchAllPages((params) => youtube.subscriptions.list(params), {
    part: 'snippet',
    mine: true,
    maxResults: 50,
  });
  return items.map((item) => ({
    channelId: item.snippet.resourceId.channelId,
    channelTitle: item.snippet.title,
  }));
}

export async function getPlaylists(auth) {
  const youtube = yt(auth);
  const playlists = await fetchAllPages((params) => youtube.playlists.list(params), {
    part: 'snippet,status',
    mine: true,
    maxResults: 50,
  });

  const result = [];
  for (const playlist of playlists) {
    const videos = await fetchAllPages((params) => youtube.playlistItems.list(params), {
      part: 'snippet',
      playlistId: playlist.id,
      maxResults: 50,
    });
    result.push({
      playlistId: playlist.id,
      title: playlist.snippet.title,
      description: playlist.snippet.description,
      privacyStatus: playlist.status.privacyStatus,
      importedPlaylistId: null,
      videos: videos.map((v) => ({
        videoId: v.snippet.resourceId.videoId,
        title: v.snippet.title,
      })),
    });
  }
  return result;
}

export async function likeVideo(auth, videoId) {
  const youtube = yt(auth);
  await backOff(() => youtube.videos.rate({ id: videoId, rating: 'like' }), BACKOFF_OPTIONS);
}

export async function subscribe(auth, channelId) {
  const youtube = yt(auth);
  await backOff(
    () =>
      youtube.subscriptions.insert({
        part: 'snippet',
        requestBody: { snippet: { resourceId: { kind: 'youtube#channel', channelId } } },
      }),
    BACKOFF_OPTIONS,
  );
}

export async function findPlaylistByTitle(auth, title) {
  const youtube = yt(auth);
  try {
    const items = [];
    let pageToken;
    do {
      const response = await backOff(
        () =>
          youtube.playlists.list({ part: 'snippet', mine: true, maxResults: 50, ...(pageToken ? { pageToken } : {}) }),
        BACKOFF_OPTIONS,
      );
      items.push(...(response.data.items ?? []));
      pageToken = response.data.nextPageToken;
    } while (pageToken);
    const match = items.find((p) => p.snippet.title === title);
    return match ? match.id : null;
  } catch {
    // Any error (401, channel not found, etc.) — skip lookup, proceed to create
    return null;
  }
}

export async function createPlaylist(auth, title, description, privacyStatus) {
  const youtube = yt(auth);
  const response = await backOff(
    () =>
      youtube.playlists.insert({
        part: 'snippet,status',
        requestBody: {
          snippet: { title, description },
          status: { privacyStatus },
        },
      }),
    BACKOFF_OPTIONS,
  );
  return response.data.id;
}

export async function addVideoToPlaylist(auth, playlistId, videoId) {
  const youtube = yt(auth);
  await backOff(
    () =>
      youtube.playlistItems.insert({
        part: 'snippet',
        requestBody: {
          snippet: {
            playlistId,
            resourceId: { kind: 'youtube#video', videoId },
          },
        },
      }),
    BACKOFF_OPTIONS,
  );
}
