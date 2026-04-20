#!/usr/bin/env node
import { Command } from 'commander'
import chalk from 'chalk'
import { login } from './auth.js'
import { exportAll } from './export.js'
import { importLikes, importSubscriptions, importPlaylists } from './import.js'

const program = new Command()

program
  .name('yttransfer')
  .description('Transfer YouTube playlists, likes and subscriptions between accounts')
  .version('1.0.0')

const loginCmd = program
  .command('login')
  .description('Authenticate a YouTube account')

loginCmd
  .command('source')
  .description('Authenticate the source account (the one you are transferring FROM)')
  .action(async () => { await login('source') })

loginCmd
  .command('dest')
  .description('Authenticate the destination account (the one you are transferring TO)')
  .action(async () => { await login('dest') })

program
  .command('export')
  .description('Export likes, subscriptions and playlists from source account to data/')
  .action(async () => {
    await exportAll()
  })

const importCmd = program
  .command('import')
  .description('Import data to the destination account')

importCmd
  .command('likes')
  .description('Import liked videos to the destination account')
  .action(async () => { await importLikes() })

importCmd
  .command('subscriptions')
  .description('Import channel subscriptions to the destination account')
  .action(async () => { await importSubscriptions() })

importCmd
  .command('playlists')
  .description('Import playlists (and their videos) to the destination account')
  .action(async () => { await importPlaylists() })

program.parseAsync(process.argv).catch((err) => {
  console.error(chalk.red(`\nUnexpected error: ${err.message}`))
  process.exit(1)
})
