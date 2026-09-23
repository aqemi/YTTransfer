import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import chalk from 'chalk'
import { getAuthClient } from './auth.js'
import { getLikedVideos, getSubscriptions, getPlaylists, formatApiError } from './youtube.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, '..', 'data')

function readExisting(filename) {
  const path = join(DATA_DIR, filename)
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return Array.isArray(parsed) ? parsed : null
  } catch {
    console.log(chalk.yellow(`\n  ⚠ data/${filename} is unreadable — writing a fresh copy`))
    return null
  }
}

// Merge freshly fetched items into whatever is already on disk: entries still
// present on the source keep their import progress, entries that disappeared
// from the source are dropped, and brand new ones arrive without an `imported`
// flag so the importer picks them up.
export function mergeItems(existing, fetched, keyOf, mergeOne) {
  if (!existing) return { merged: fetched, added: fetched.length, removed: 0, kept: 0 }

  const previous = new Map(existing.map((item) => [keyOf(item), item]))
  let added = 0
  let kept = 0

  const merged = fetched.map((item) => {
    const match = previous.get(keyOf(item))
    if (!match) {
      added++
      return item
    }
    kept++
    return mergeOne ? mergeOne(match, item) : { ...item, ...(match.imported ? { imported: true } : {}) }
  })

  return { merged, added, removed: existing.length - kept, kept }
}

function formatMergeSummary({ added, removed, kept }) {
  if (!kept && !removed) return ''
  return chalk.gray(` (${added} new, ${removed} removed, ${kept} kept)`)
}

export function mergePlaylist(previous, fetched) {
  const videos = mergeItems(previous.videos, fetched.videos, (v) => v.videoId)
  return {
    ...fetched,
    importedPlaylistId: previous.importedPlaylistId ?? null,
    videos: videos.merged,
  }
}

function writeData(filename, data) {
  writeFileSync(join(DATA_DIR, filename), JSON.stringify(data, null, 2))
}

async function exportLikes(auth) {
  process.stdout.write(chalk.cyan('  Exporting liked videos... '))
  try {
    const likes = await getLikedVideos(auth)
    const result = mergeItems(readExisting('likes.json'), likes, (v) => v.videoId)
    writeData('likes.json', result.merged)
    console.log(chalk.green(`✓ ${result.merged.length} videos`) + formatMergeSummary(result))
  } catch (err) {
    console.log(chalk.red('✗'))
    console.error(chalk.red(`  Failed to export likes: ${formatApiError(err)}`))
    process.exit(1)
  }
}

async function exportSubscriptions(auth) {
  process.stdout.write(chalk.cyan('  Exporting subscriptions... '))
  try {
    const subs = await getSubscriptions(auth)
    const result = mergeItems(readExisting('subscriptions.json'), subs, (s) => s.channelId)
    writeData('subscriptions.json', result.merged)
    console.log(chalk.green(`✓ ${result.merged.length} channels`) + formatMergeSummary(result))
  } catch (err) {
    console.log(chalk.red('✗'))
    console.error(chalk.red(`  Failed to export subscriptions: ${formatApiError(err)}`))
    process.exit(1)
  }
}

async function exportPlaylists(auth) {
  process.stdout.write(chalk.cyan('  Exporting playlists... '))
  try {
    const playlists = await getPlaylists(auth)
    const result = mergeItems(readExisting('playlists.json'), playlists, (p) => p.playlistId, mergePlaylist)
    const totalVideos = result.merged.reduce((sum, p) => sum + p.videos.length, 0)
    writeData('playlists.json', result.merged)
    console.log(
      chalk.green(`✓ ${result.merged.length} playlists, ${totalVideos} videos`) + formatMergeSummary(result),
    )
  } catch (err) {
    console.log(chalk.red('✗'))
    console.error(chalk.red(`  Failed to export playlists: ${formatApiError(err)}`))
    process.exit(1)
  }
}

export async function exportAll() {
  console.log(chalk.bold.cyan('\n◆ Exporting from source account\n'))

  const auth = await getAuthClient('source')
  mkdirSync(DATA_DIR, { recursive: true })

  await exportLikes(auth)
  await exportSubscriptions(auth)
  await exportPlaylists(auth)

  console.log(chalk.bold.green('\n✓ Export complete! Data saved to data/'))
}
