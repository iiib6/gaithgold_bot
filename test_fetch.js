async function testIraqSM_FX_Details() {
  const url = 'https://iraqsm.com/fx';
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (res.ok) {
      const html = await res.text();
      console.log('--- Printing around the value="154250" or similar ---');
      
      const idx = html.indexOf('154250');
      if (idx !== -1) {
        console.log('Context of 154250:', html.substring(idx - 200, idx + 300));
      }

      // Let's print any Next.js JSON state blocks to see if there is a clean state we can parse
      const terms = ['"parallel"', '"market"', '"rate"', '154', '153', '152', '151', '150', '149', '148'];
      terms.forEach(term => {
        let offset = 0;
        let foundIdx = -1;
        while ((foundIdx = html.toLowerCase().indexOf(term.toLowerCase(), offset)) !== -1) {
          console.log(`Found term "${term}" at ${foundIdx}:`, html.substring(foundIdx - 40, foundIdx + 80).replace(/\s+/g, ' '));
          offset = foundIdx + term.length;
          if (offset > foundIdx + 200) break; // Limit
          break; // just first one
        }
      });

      // Let's see if we can find other numbers like 1310 (official rate)
      const officialIdx = html.indexOf('1310');
      if (officialIdx !== -1) {
        console.log('Official rate 1310 context:', html.substring(officialIdx - 100, officialIdx + 100));
      } else {
        console.log('1310 not found');
      }

      const officialIdx2 = html.indexOf('1311');
      if (officialIdx2 !== -1) {
        console.log('Official rate 1311 context:', html.substring(officialIdx2 - 100, officialIdx2 + 100));
      } else {
        console.log('1311 not found');
      }
    }
  } catch (e) {
    console.error('Fetch failed:', e.message);
  }
}

testIraqSM_FX_Details();
