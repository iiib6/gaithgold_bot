const localtunnel = require('localtunnel');

const port = 3000;
const subdomain = 'algaith-gold-dashboard';

async function startTunnel() {
  console.log(`Starting tunnel on port ${port} with subdomain "${subdomain}"...`);
  try {
    const tunnel = await localtunnel({ port, subdomain });
    
    console.log(`=========================================`);
    console.log(`🚀 Tunnel is active!`);
    console.log(`🔗 URL: ${tunnel.url}`);
    console.log(`=========================================`);
    
    // If the subdomain wasn't granted (e.g. it fell back to a random name),
    // let's close it and try again after a delay. This prevents keeping a random url!
    if (!tunnel.url.includes(subdomain)) {
      console.warn(`⚠️ Warning: Subdomain "${subdomain}" not granted. Assigned: ${tunnel.url}. Retrying in 10s...`);
      tunnel.close();
      setTimeout(startTunnel, 10000);
      return;
    }
    
    tunnel.on('close', () => {
      console.log('Tunnel connection closed. Reconnecting in 5 seconds...');
      setTimeout(startTunnel, 5000);
    });
    
    tunnel.on('error', (err) => {
      console.error('Tunnel error:', err);
      try {
        tunnel.close();
      } catch (e) {}
    });
  } catch (err) {
    console.error('Failed to start tunnel:', err.message);
    console.log('Retrying in 10 seconds...');
    setTimeout(startTunnel, 10000);
  }
}

startTunnel();
