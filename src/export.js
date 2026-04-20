import { writeFileSync, mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import chalk from 'chalk'
import { getAuthClient } from './auth.js'
import { getLikedVideos, getSubscriptions, getPlaylists, formatApiError } from './youtube.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, '..', 'data')

async function exportLikes(auth) {
  process.stdout.write(chalk.cyan('  Exporting liked videos... '))
  try {
    const likes = await getLikedVideos(auth)
    writeFileSync(join(DATA_DIR, 'likes.json'), JSON.stringify(likes, null, 2))
    console.log(chalk.green(`✓ ${likes.length} videos`))
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
    writeFileSync(join(DATA_DIR, 'subscriptions.json'), JSON.stringify(subs, null, 2))
    console.log(chalk.green(`✓ ${subs.length} channels`))
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
    const totalVideos = playlists.reduce((sum, p) => sum + p.videos.length, 0)
    writeFileSync(join(DATA_DIR, 'playlists.json'), JSON.stringify(playlists, null, 2))
    console.log(chalk.green(`✓ ${playlists.length} playlists, ${totalVideos} videos`))
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
