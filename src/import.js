import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import chalk from 'chalk';
import { getAuthClient } from './auth.js';
import {
  likeVideo,
  subscribe,
  findPlaylistByTitle,
  createPlaylist,
  addVideoToPlaylist,
  formatApiError,
} from './youtube.js';

const RATINGS_DISABLED_PLAYLIST = 'Failed to Like (ratings disabled)';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');

function loadDataFile(filename) {
  const path = join(DATA_DIR, filename);
  if (!existsSync(path)) {
    console.error(chalk.red(`Data file not found: data/${filename}`));
    console.error(chalk.yellow('Run: yttransfer export'));
    process.exit(1);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

function saveDataFile(filename, data) {
  writeFileSync(join(DATA_DIR, filename), JSON.stringify(data, null, 2));
}

export async function importLikes() {
  console.log(chalk.bold.cyan('\n◆ Importing liked videos to dest account\n'));

  const auth = await getAuthClient('dest');
  const likes = loadDataFile('likes.json');

  let succeeded = 0;
  let skipped = 0;
  let alreadyDone = 0;
  let ratingDisabled = 0;
  let ratingsDisabledPlaylistId = null;

  for (const video of [...likes].reverse()) {
    if (video.imported) {
      alreadyDone++;
      continue;
    }
    try {
      await likeVideo(auth, video.videoId);
      video.imported = true;
      saveDataFile('likes.json', likes);
      console.log(chalk.green(`  ✓ Liked: ${video.title}`));
      succeeded++;
    } catch (err) {
      const status = err?.response?.status;
      const reason = err?.response?.data?.error?.errors?.[0]?.reason;
      if (status === 404) {
        video.imported = true;
        saveDataFile('likes.json', likes);
        console.log(chalk.yellow(`  ⚠ Skipped (unavailable): ${video.title}`));
        skipped++;
      } else if (status === 403 && reason === 'videoRatingDisabled') {
        // Resolve the fallback playlist once, lazily
        if (!ratingsDisabledPlaylistId) {
          const existingId = await findPlaylistByTitle(auth, RATINGS_DISABLED_PLAYLIST);
          if (existingId) {
            ratingsDisabledPlaylistId = existingId;
          } else {
            ratingsDisabledPlaylistId = await createPlaylist(
              auth,
              RATINGS_DISABLED_PLAYLIST,
              'Videos that could not be liked because the owner disabled ratings.',
              'private',
            );
            console.log(chalk.cyan(`  ℹ Created playlist "${RATINGS_DISABLED_PLAYLIST}"`));
          }
        }
        try {
          await addVideoToPlaylist(auth, ratingsDisabledPlaylistId, video.videoId);
          console.log(chalk.yellow(`  ⚠ Ratings disabled — added to fallback playlist: ${video.title}`));
        } catch (error) {
          console.log(chalk.yellow(`  ⚠ Ratings disabled & could not add to playlist: ${video.title}`));
          throw error;
        }
        video.imported = true;
        saveDataFile('likes.json', likes);
        ratingDisabled++;
      } else {
        console.error(chalk.red(`  ✗ Failed: ${video.title} — ${formatApiError(err)}`));
        process.exit(1);
      }
    }
  }

  console.log(
    chalk.bold.green(
      `\n✓ Likes import done: ${succeeded} imported, ${skipped} skipped, ${ratingDisabled} moved to fallback playlist, ${alreadyDone} already done`,
    ),
  );
}

export async function importSubscriptions() {
  console.log(chalk.bold.cyan('\n◆ Importing subscriptions to dest account\n'));

  const auth = await getAuthClient('dest');
  const subs = loadDataFile('subscriptions.json');

  let succeeded = 0;
  let skipped = 0;
  let alreadyDone = 0;

  for (const sub of subs) {
    if (sub.imported) {
      alreadyDone++;
      continue;
    }
    try {
      await subscribe(auth, sub.channelId);
      sub.imported = true;
      saveDataFile('subscriptions.json', subs);
      console.log(chalk.green(`  ✓ Subscribed: ${sub.channelTitle}`));
      succeeded++;
    } catch (err) {
      const status = err?.response?.status;
      if (status === 404) {
        sub.imported = true;
        saveDataFile('subscriptions.json', subs);
        console.log(chalk.yellow(`  ⚠ Skipped (channel not found): ${sub.channelTitle}`));
        skipped++;
      } else if (status === 400 && err?.response?.data?.error?.errors?.[0]?.reason === 'subscriptionDuplicate') {
        sub.imported = true;
        saveDataFile('subscriptions.json', subs);
        console.log(chalk.gray(`  ~ Already subscribed: ${sub.channelTitle}`));
        skipped++;
      } else {
        console.error(chalk.red(`  ✗ Failed: ${sub.channelTitle} — ${formatApiError(err)}`));
        process.exit(1);
      }
    }
  }

  console.log(
    chalk.bold.green(
      `\n✓ Subscriptions import done: ${succeeded} imported, ${skipped} skipped, ${alreadyDone} already done`,
    ),
  );
}

export async function importPlaylists() {
  console.log(chalk.bold.cyan('\n◆ Importing playlists to dest account\n'));

  const auth = await getAuthClient('dest');
  const playlists = loadDataFile('playlists.json');

  let playlistsSucceeded = 0;

  for (const playlist of playlists) {
    console.log(chalk.cyan(`\n  Playlist: ${chalk.bold(playlist.title)} (${playlist.videos.length} videos)`));

    // Step 1: resolve or create the playlist on the dest account
    if (!playlist.importedPlaylistId) {
      try {
        const existingId = await findPlaylistByTitle(auth, playlist.title);
        if (existingId) {
          playlist.importedPlaylistId = existingId;
          saveDataFile('playlists.json', playlists);
          console.log(chalk.gray(`    ~ Found existing playlist (id: ${existingId})`));
        } else {
          const newId = await createPlaylist(auth, playlist.title, playlist.description, playlist.privacyStatus);
          playlist.importedPlaylistId = newId;
          saveDataFile('playlists.json', playlists);
          console.log(chalk.green(`    ✓ Created playlist (id: ${newId})`));
        }
      } catch (err) {
        console.error(chalk.red(`    ✗ Failed to resolve playlist "${playlist.title}" — ${formatApiError(err)}`));
        process.exit(1);
      }
    } else {
      console.log(chalk.gray(`    ~ Playlist already resolved (id: ${playlist.importedPlaylistId})`));
    }

    // Step 2: add each video
    let videoSucceeded = 0;
    let videoSkipped = 0;
    let videoAlreadyDone = 0;

    for (const video of playlist.videos) {
      if (video.imported) {
        videoAlreadyDone++;
        continue;
      }

      try {
        await addVideoToPlaylist(auth, playlist.importedPlaylistId, video.videoId);
        video.imported = true;
        saveDataFile('playlists.json', playlists);
        console.log(chalk.green(`    ✓ Added: ${video.title}`));
        videoSucceeded++;
      } catch (err) {
        const status = err?.response?.status;
        if (status === 404 || status === 400) {
          console.log(chalk.yellow(`    ⚠ Skipped (unavailable): ${video.title}`));
          videoSkipped++;
        } else {
          console.error(chalk.red(`    ✗ Failed to add video "${video.title}" — ${formatApiError(err)}`));
          process.exit(1);
        }
      }
    }

    playlistsSucceeded++;
    console.log(chalk.bold(`    → ${videoSucceeded} added, ${videoSkipped} skipped, ${videoAlreadyDone} already done`));
  }

  console.log(chalk.bold.green(`\n✓ Playlists import done: ${playlistsSucceeded} playlists processed`));
}
