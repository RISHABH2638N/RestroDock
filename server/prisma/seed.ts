// Keep this entry point portable; Prisma CLI and npm both call the guarded command.
import {runDatabaseCommand} from '../scripts/database-cli.js';
process.exitCode=await runDatabaseCommand('seed');
