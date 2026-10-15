const {chromium}=require('playwright');
const fs=require('fs');
(async()=>{
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const fixture=JSON.parse(fs.readFileSync('/tmp/ai-browser.json','utf8'));
  let mode='valid';
  await page.route('**/data/ai_cycle.json',route=>{
    if(mode==='failed')return route.abort();
    const record=JSON.parse(JSON.stringify(fixture));
    if(mode==='stale'){record.analysis.issue='00000';record.review.identity.snapshot_hash='bad';}
    return route.fulfill({json:record});
  });
  await page.goto('http://127.0.0.1:8878/',{waitUntil:'networkidle'});
  for(const id of ['ai-overview','ai-single','ai-compound','ai-review','ai-next']){
    const text=await page.locator('#'+id).innerText();
    if(!text.includes('本期依据真实数据'))throw Error('AI section not rendered: '+id);
  }
  if((await page.locator('#ai-review').innerText()).includes('事前AI已推荐'))throw Error('fake historical AI claim');
  if(!await page.locator('#content').isVisible() || await page.locator('#primary-recommendation .ball').count()!==7)throw Error('primary regression');
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('overflow');
  await page.screenshot({path:'/tmp/ai-cycle-mobile.png',fullPage:true});
  mode='stale';await page.reload({waitUntil:'networkidle'});
  if(!(await page.locator('#ai-single').innerText()).includes('待生成') || !(await page.locator('#ai-review').innerText()).includes('待生成'))throw Error('stale AI shown');
  mode='failed';await page.reload({waitUntil:'networkidle'});
  if(!(await page.locator('#ai-overview').innerText()).includes('暂不可用') || !await page.locator('#content').isVisible() || await page.locator('#primary-recommendation .ball').count()!==7)throw Error('AI failure blocked homepage');
  if(errors.length)throw Error(errors.join('\n'));
  console.log('AI mobile sections / stale identity / missing data / original primary: PASS');
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
