import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export async function verifyService({origin,engine,auth,tableId,qrToken,menuItem,ownerHeaders,workerHeaders,chefHeaders,cashierHeaders,platformHeaders,pilotSession,guestHeaders,orders}) {
  const query='?'+new URLSearchParams(auth);
  const table='/api/v1/staff/tables/'+tableId;
  const kitchen='/api/v1/staff/kitchen';
  const publicHeaders={Origin:origin,'Content-Type':'application/json'};
  async function call(path,headers,{body,method=body===undefined?'GET':'POST',status=200}={}) {
    const response=await fetch(origin+path,{method,headers,signal:AbortSignal.timeout(15000),
      ...(body===undefined?{}:{body:JSON.stringify(body)})});
    assert.equal(response.status,status,`${method} ${path.split('?')[0]}`);
    return response.json();
  }
  const board=()=>call('/api/v1/staff/tables'+query,cashierHeaders);
  async function serve(orderId) {
    const steps=[
      ['ACCEPT','ACCEPTED',chefHeaders],['PREPARE','PREPARING',chefHeaders],
      ['READY','READY',chefHeaders],['SERVE','SERVED',workerHeaders],
    ];
    const {tickets:initial}=await call(kitchen+query,chefHeaders);
    const initialStatus=initial.find(ticket=>ticket.id===orderId)?.status;
    assert.ok(initialStatus==='PLACED'||initialStatus==='READY');
    for(const [action,status,headers] of initialStatus==='READY'?steps.slice(-1):steps) {
      const {tickets}=await call(kitchen+query,headers);
      const ticket=tickets.find(item=>item.id===orderId);
      assert.ok(ticket,`Ticket visible before ${action}`);
      await call(kitchen+'/'+orderId+'/action'+query,headers,{body:{version:ticket.version,action}});
      const next=await call(kitchen+query,headers);
      assert.equal(next.tickets.find(item=>item.id===orderId)?.status,status);
    }
  }

  // Provision a second tenant through the same control-plane API as production.
  const other=await call('/api/v1/super-admin/tenants',platformHeaders,{status:201,body:{
    name:'Synthetic other restaurant',slug:'synthetic-other-restaurant',
    branchName:'Other branch',adminEmail:'other-owner@synthetic.test',planCode:'TRIAL',
  }});
  const otherScope='?'+new URLSearchParams({tenantId:other.tenant.id,branchId:other.tenant.branches[0].id});
  await call('/api/v1/staff/tables'+otherScope,cashierHeaders,{status:403});
  await call(kitchen+otherScope,chefHeaders,{status:403});
  console.log('PASS assigned cashier and chef cannot read a second tenant');

  for(const orderId of orders)await serve(orderId);
  await call('/api/v1/guest/bill',guestHeaders,{body:{}});
  const current=(await board()).items.find(item=>item.id===tableId).session;
  assert.ok(current.billRequestedAt);
  const external=await call(table+'/settle'+query,cashierHeaders,{body:{
    sessionId:pilotSession.id,version:current.version,externalBillReference:'E2E-POS-001',paymentMethod:'UPI',confirmed:true,
  }});
  assert.equal(external.board.items.find(item=>item.id===tableId).session,null);
  const settlement=await engine.query('SELECT "externalBillReference", "paymentMethod" FROM "BillingHandoff" WHERE "diningSessionId"=$1',[pilotSession.id]);
  assert.deepEqual(settlement.rows,[{externalBillReference:'E2E-POS-001',paymentMethod:'UPI'}]);
  console.log('PASS served orders close through external POS with one saved invoice reference');

  const tenantPath='/api/v1/super-admin/tenants/'+auth.tenantId;
  const tenant=await call(tenantPath,platformHeaders);
  await call(tenantPath,platformHeaders,{method:'PATCH',body:{version:tenant.version,billingMode:'RESTRODOCK'}});
  const row=(await board()).items.find(item=>item.id===tableId);
  const opened=await call('/api/v1/restaurant/tables/'+tableId+'/open'+query,ownerHeaders,{body:{version:row.version,durationMinutes:120}});
  const session=opened.board.items.find(item=>item.id===tableId).session;
  let browser;
  try {
    if(process.env.RESTRODOCK_BROWSER_MODULE) {
      const {chromium}=await import(pathToFileURL(process.env.RESTRODOCK_BROWSER_MODULE).href);
      browser=await chromium.launch(process.env.RESTRODOCK_CHROMIUM?{executablePath:process.env.RESTRODOCK_CHROMIUM}:{});
    } else if(process.env.RESTRODOCK_REQUIRE_BROWSER==='1') {
      throw new Error('Set RESTRODOCK_BROWSER_MODULE to the installed Playwright entry file.');
    }
    let order,guestPage;
    if(browser){
      guestPage=await browser.newPage();
      await guestPage.goto(origin+'/q#'+qrToken);
      await guestPage.getByRole('button',{name:'Customize Synthetic smoke item'}).click();
      await guestPage.getByRole('button',{name:/Add to cart/}).click();
      await guestPage.getByRole('button',{name:'Place order'}).click();
      await guestPage.getByLabel('Six-digit code from your waiter').fill(opened.pin);
      await guestPage.getByLabel('Your name').fill('Synthetic browser guest');
      await guestPage.getByLabel('Mobile number').fill('+919999999999');
      await guestPage.getByRole('dialog').getByRole('checkbox').check();
      const response=guestPage.waitForResponse(r=>r.url().endsWith('/guest/orders')&&r.request().method()==='POST');
      await guestPage.getByRole('button',{name:'Verify and place order'}).click();
      const placed=await response;
      assert.equal(placed.status(),201);
      order=await placed.json();
      await guestPage.getByRole('heading',{name:'Your orders'}).waitFor();
      const request=placed.request();
      const headers=await request.allHeaders();
      const repeated=await guestPage.request.post(request.url(),{
        headers:{...publicHeaders,'X-CSRF-Token':headers['x-csrf-token']},
        data:request.postDataJSON(),
      });
      assert.equal(repeated.status(),200);
      assert.deepEqual(await repeated.json(),order);
    }else{
      const response=await fetch(origin+'/api/v1/table-entry/join',{method:'POST',headers:publicHeaders,body:JSON.stringify({
        qrToken,sessionId:session.id,pinVersion:session.pinVersion,pin:opened.pin,displayName:'Synthetic guest',
        mobile:'+919999999999',privacyAccepted:true,guestSecret:randomBytes(32).toString('base64url'),
      })});
      assert.equal(response.status,200);
      const guest=await response.json();
      guestHeaders={...publicHeaders,Cookie:response.headers.getSetCookie()[0].split(';')[0],'X-CSRF-Token':guest.csrfToken};
      const body={key:randomUUID(),cartId:guest.cartId,lines:[{itemId:menuItem.id,quantity:1,variant:null,addons:[],note:'',expectedUnitPriceMinor:12550}]};
      order=await call('/api/v1/guest/orders',guestHeaders,{body,status:201});
      assert.deepEqual(await call('/api/v1/guest/orders',guestHeaders,{body}),order);
    }
    if(order.status==='AWAITING_REVIEW'){
      const review='/api/v1/restaurant/order-review';
      const {pending}=await call(review+query,ownerHeaders);
      const ticket=pending.find(item=>item.id===order.orderId);
      assert.ok(ticket,'Repeated order is visible in review');
      await call(review+'/'+order.orderId+'/decision'+query,ownerHeaders,{
        body:{version:ticket.version,decision:'APPROVE',override:true},
      });
    }
    await serve(order.orderId);
    if(guestPage){
      await guestPage.locator('.guest-tracking-order').getByText('Served',{exact:true}).waitFor();
      await guestPage.getByRole('button',{name:'Request bill'}).click();
      await guestPage.getByRole('button',{name:'Request bill'}).click();
      await guestPage.getByText('Bill requested',{exact:true}).waitFor();
    }else await call('/api/v1/guest/bill',guestHeaders,{body:{}});
    const bill=(await board()).items.find(item=>item.id===tableId).session;
    const payment={sessionId:session.id,version:bill.version,billingMode:'RESTRODOCK',paymentMethod:'CASH',confirmed:true};
    if(browser){
      const cashier=await browser.newContext();
      const token=cashierHeaders.Cookie.split('=')[1];
      await cashier.addCookies([{name:'restrodock_session',value:token,url:origin,httpOnly:true}]);
      const page=await cashier.newPage();
      await page.goto(origin+'/staff/billing');
      await page.getByLabel('Payment method').selectOption('CASH');
      await page.getByLabel('I received the full amount.').check();
      await page.getByRole('button',{name:'Confirm payment and release table'}).click();
      await page.getByText(/Payment recorded and the table is available/).waitFor();
      await page.getByText('Recent RestroDock receipts').click();
      await page.locator('summary').filter({hasText:/Synthetic table ·/}).click();
      await page.getByText(/Payment receipt · RD-/).waitFor();
      console.log('PASS Chromium guest checkout, tracking, bill request and cashier receipt');
    }else await call(table+'/settle'+query,cashierHeaders,{body:payment});
    const replay=await call(table+'/settle'+query,cashierHeaders,{body:payment});
    const settled=replay.board.items.find(item=>item.id===tableId);
    assert.equal(settled.session,null);
    assert.equal(settled.receipt.totalMinor,12550);
    assert.equal(settled.receipt.lines[0].amountMinor,12550);
    const counts=await engine.query('SELECT (SELECT count(*)::int FROM "BillingHandoff" WHERE "diningSessionId"=$1) AS receipts, (SELECT count(*)::int FROM "Order" WHERE "diningSessionId"=$1) AS orders',[session.id]);
    assert.deepEqual(counts.rows,[{receipts:1,orders:1}]);
    console.log('PASS RestroDock billing saves one itemized receipt and releases the table after retry');
  } finally {
    await browser?.close();
  }
}
