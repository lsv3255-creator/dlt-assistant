const {chromium}=require('playwright');
(async()=>{const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:8877/',{waitUntil:'networkidle'});
await page.waitForFunction(()=>document.querySelector('#compound-body').textContent.includes('672'));
console.log(JSON.stringify({errors,contentVisible:await page.locator('#content').isVisible(),primary:await page.locator('#primary-recommendation .ball').allTextContents(),details:await page.locator('#draw-details-body').innerText(),compound:await page.locator('#compound-body').innerText(),overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)}));
await page.selectOption('#draw-detail-issue','26105');if(!(await page.locator('#draw-details-body').innerText()).includes('2026-09-14'))throw Error('selector failed');
await page.route('**/data/draw_details.json',r=>r.abort());await page.route('**/data/compound_recommendation.json',r=>r.abort());await page.reload({waitUntil:'networkidle'});console.log('Failure isolation',await page.locator('#content').isVisible(),await page.locator('#primary-recommendation .ball').count(),errors);
for(const path of ['my.html']){await page.goto('http://127.0.0.1:8877/'+path,{waitUntil:'networkidle'});console.log('route',path,'errors',errors);}
await browser.close();if(errors.length)process.exit(1);})().catch(e=>{console.error(e);process.exit(1)});
