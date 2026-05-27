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
