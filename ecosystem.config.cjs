// Standalone pm2 config for nomic-bot.
//
// On a VPS that already uses a central ecosystem (e.g., ~/pm2/ecosystem.config.js
// for multiple apps), add the same app entry to that file instead and ignore
// this one. See DEPLOY.md for the central-ecosystem pattern.
module.exports = {
  apps: [
    {
      name: 'nomic-bot',
      script: './dist/index.js',
      cwd: __dirname,
      env_production: {
        NODE_ENV: 'production',
      },
      max_memory_restart: '256M',
      autorestart: true,
      watch: false,
      time: true,
      out_file: './logs/out.log',
      error_file: './logs/err.log',
      merge_logs: true,
    },
  ],
};
