'use client';

import {useEffect,useState,type FormEvent,type ReactNode} from 'react';
import {analyticsReportSchema,type AnalyticsReport} from '@restrodock/contracts';
import {CalendarDays,ClipboardCheck,Clock3,Download,IndianRupee,ReceiptText} from 'lucide-react';
import {accessRequest,errorText} from '../access/api';

const integer=new Intl.NumberFormat('en-IN');
const rupees=new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'});
const shortDate=new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',timeZone:'UTC'});
const dateCaption=new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
type Range={start:string;end:string}|{period:'today'};
const money=(minor:number)=>rupees.format(minor/100);
const hourLabel=(hour:number)=>String(hour).padStart(2,'0')+':00';
const timeLabel=(seconds:number|null)=>seconds===null?'Unavailable':`${Math.floor(seconds/60)}m ${seconds%60}s`;
const amount=(minor:number)=>(minor/100).toFixed(2);
const averageOrder=(metrics:AnalyticsReport['drilldown']['current'])=>
 metrics.eligible?Math.round(metrics.estimatedMinor/metrics.eligible):null;

function periodMetrics(metrics:AnalyticsReport['drilldown']['current']){
 return [
  ['Orders received',metrics.orders],
  ['Orders included in estimates',metrics.eligible],
  ['Estimated order value',metrics.estimatedMinor],
  ['Average estimated order value',averageOrder(metrics)],
  ['Cancelled orders',metrics.cancelled],
  ['Rejected orders',metrics.rejected],
 ] as const;
}

function csvCell(value:string|number){
 const text=String(value);
 const safe=typeof value==='string'&&/^[\s\uFEFF]*[=+\-@\t\r\n]/u.test(text)?"'"+text:text;
 return '"'+safe.replaceAll('"','""')+'"';
}

export function reportCsv(report:AnalyticsReport){
 const {totals,drilldown}=report;
 const {current,previous}=drilldown;
 const rows=[
  ['Report section','Metric or date','Value','Secondary value'],
  ['Period','Start date',report.start],['Period','End date',report.end],['Period','Time zone',report.timezone],
  ['Summary','Orders received',totals.orders],['Summary','Orders held',totals.held],['Summary','Still awaiting review',totals.pendingReview],
  ['Summary','Estimated order value (INR)',(totals.estimatedMinor/100).toFixed(2)],
  ['Summary','Confirmed payment amount (INR)','Unavailable'],
  ['Summary','Bill requests',totals.billRequests],['Summary','Confirmed POS settlements',totals.confirmedSettlements],
  ['Summary','Average accepted-to-ready time (seconds)',totals.kitchenAverageSeconds??'Unavailable'],
  ['Summary','Kitchen timing sample',totals.kitchenSample],
  ['Daily order volume','Local date','Orders received','Orders held'],
  ...report.days.map(day=>['Daily order volume',day.date,day.orders,day.held]),
  ['Top 10 item demand','Item','Quantity'],
  ...report.demand.map(item=>['Top 10 item demand',item.name,item.quantity]),
  ['Comparison','Previous start',drilldown.previousStart],['Comparison','Previous end',drilldown.previousEnd],
  ['Comparison','Metric','Selected period','Previous period'],
  ...periodMetrics(current).map(([label,value],index)=>{
   const format=(number:number|null)=>number===null?'Unavailable':index===2||index===3?amount(number):number;
   return ['Comparison',index===2||index===3?label+' (INR)':label,format(value),format(periodMetrics(previous)[index]![1])];
  }),
  ['Daily estimated value','Local date','Eligible orders','Estimated value (INR)'],
  ...drilldown.dailyValue.map(day=>['Daily estimated value',day.date,day.eligible,amount(day.estimatedMinor)]),
  ['Hourly demand','Local hour','Orders received'],
  ...drilldown.hours.map(hour=>['Hourly demand',hourLabel(hour.hour),hour.orders]),
  ['Menu performance','Item','Current category','Quantity','Estimated value (INR)','Orders containing item'],
  ...drilldown.menu.map(item=>['Menu performance',item.name,item.category,item.quantity,amount(item.estimatedMinor),item.orders]),
  ['Category performance','Current category','Quantity','Estimated value (INR)'],
  ...drilldown.categories.map(category=>['Category performance',category.name,category.quantity,amount(category.estimatedMinor)]),
  ['Kitchen','Preparation timing sample',drilldown.preparation.sample],
  ['Kitchen','Median preparation (seconds)',drilldown.preparation.medianSeconds??'Unavailable'],
  ['Kitchen','90th percentile preparation (seconds)',drilldown.preparation.p90Seconds??'Unavailable'],
 ];
 return rows.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
}

function download(report:AnalyticsReport){
 const url=URL.createObjectURL(new Blob(['\uFEFF',reportCsv(report)],{type:'text/csv;charset=utf-8'}));
 const link=document.createElement('a');
 link.href=url;
 link.download=`restrodock-analytics-${report.start}-${report.end}.csv`;
 document.body.append(link);
 link.click();
 link.remove();
 window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export function BranchAnalytics({tenantId,branchId}:{tenantId:string;branchId:string}){
 const [range,setRange]=useState<Range|null>(null);
 const [report,setReport]=useState<AnalyticsReport|null>(null);
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(true);
 const [attempt,setAttempt]=useState(0);
 useEffect(()=>{
  let current=true;
  const query=new URLSearchParams({tenantId,branchId,...range});
  void accessRequest('/restaurant/analytics?'+query).then(value=>{
   const data=analyticsReportSchema.parse(value);
   if(current)setReport(data);
  }).catch(reason=>{
   if(current)setError(errorText(reason));
  }).finally(()=>{
   if(current)setBusy(false);
  });
  return ()=>{current=false;};
 },[tenantId,branchId,range,attempt]);

 function load(next:Range|null){
  setReport(null);
  setError('');
  setBusy(true);
  setRange(next);
  setAttempt(value=>value+1);
 }

 function apply(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  const fields=new FormData(event.currentTarget);
  load({start:String(fields.get('start')),end:String(fields.get('end'))});
 }

 const selected=range===null?'week':'period' in range?'today':'custom';
 const custom=range&&'start' in range?range:null;
 const start=report?.start??custom?.start;
 const end=report?.end??custom?.end;
 const caption=report?dateCaption.formatRange(new Date(report.start),new Date(report.end)):null;

 return <div className="rd-analytics" aria-busy={busy}>
  <section className="rd-panel rd-analytics-period" aria-labelledby="rd-report-period">
   <div className="rd-analytics-heading">
    <div>
     <h2 id="rd-report-period">Report period</h2>
     {report&&<p className="rd-period-caption"><CalendarDays size={15} aria-hidden="true"/><span>{caption}</span><span>· {report.timezone}</span></p>}
    </div>
    <button type="button" className="button secondary" disabled={!report} onClick={()=>{if(report)download(report);}}><Download size={16} aria-hidden="true"/>Export CSV</button>
   </div>
   <form className="access-form rd-analytics-filters" onSubmit={apply}>
    <label>Start date<input key={start} type="date" name="start" required defaultValue={start}/></label>
    <label>End date<input key={end} type="date" name="end" required defaultValue={end}/></label>
    <button className="button secondary" disabled={busy}>Apply dates</button>
    <div className="rd-analytics-presets" role="group" aria-label="Quick report periods">
     <button type="button" disabled={busy} aria-pressed={selected==='today'} onClick={()=>load({period:'today'})}>Today</button>
     <button type="button" disabled={busy} aria-pressed={selected==='week'} onClick={()=>load(null)}>Last 7 days</button>
    </div>
   </form>
  </section>
  {busy&&<p role="status" className="rd-panel rd-analytics-loading">Loading branch analytics…</p>}
  {error&&<p role="alert" className="access-error">{error} <button type="button" className="text-button" onClick={()=>load(range)}>Retry report</button></p>}
  {report&&<>
   <nav className="rd-menu-summary-links rd-report-jumps" aria-label="Report sections">
    <a href="#rd-analytics-summary">Performance overview</a>
    <a href="#rd-drilldowns-title">Detailed reports</a>
    <a href="#rd-pos-activity">POS activity</a>
   </nav>
   <AnalyticsResults report={report}/>
  </>}
 </div>;
}

function AnalyticsResults({report}:{report:AnalyticsReport}){
 const {demand,totals}=report;
 const topQuantity=Math.max(1,...demand.map(item=>item.quantity));
 const average=totals.kitchenAverageSeconds;
 const metrics=[
  {label:'Orders received',value:integer.format(totals.orders),detail:'In the selected period',Icon:ReceiptText},
  {label:'Held for review',value:integer.format(totals.held),detail:integer.format(totals.pendingReview)+' still awaiting review',Icon:ClipboardCheck},
  {label:'Average kitchen time',value:timeLabel(average),
   detail:integer.format(totals.kitchenSample)+' timed tickets · acceptance to ready',Icon:Clock3},
  {label:'Estimated order value',value:money(totals.estimatedMinor),detail:'Orders that cleared review, excluding cancellations and rejections',Icon:IndianRupee},
 ];
 return <>
  <dl id="rd-analytics-summary" className="rd-panel rd-analytics-metrics" aria-label="Analytics summary">
   {metrics.map(({label,value,detail,Icon})=><div className="rd-analytics-metric" key={label}>
    <dt><Icon size={16} aria-hidden="true"/>{label}</dt><dd>{value}</dd><dd>{detail}</dd>
   </div>)}
  </dl>
  <div className="rd-analytics-details">
   <OrderVolume report={report}/>
   <section className="rd-panel rd-top-dishes">
    <h2>Top dishes</h2><p>Up to 10 dishes ranked by quantity on orders that cleared review, excluding cancellations and rejections.</p>
    {demand.length?<ol className="rd-demand">{demand.map((item,index)=><li key={item.name}>
     <span className="rd-dish-rank" aria-hidden="true">{index+1}</span>
     <div><span>{item.name}</span><div className="rd-dish-track" aria-hidden="true"><i style={{width:`${item.quantity/topQuantity*100}%`}}/></div></div>
     <strong>{integer.format(item.quantity)}<span className="sr-only"> ordered</span></strong>
    </li>)}</ol>:<p className="rd-analytics-empty">No eligible dish orders in this period.</p>}
   </section>
  </div>
  <AnalyticsDrilldowns report={report}/>
  <section id="rd-pos-activity" className="rd-panel rd-pos-activity">
   <h2>POS activity</h2>
   <dl className="rd-analytics-summary">
    <div><dt>Bill requests</dt><dd>{integer.format(totals.billRequests)}</dd></div>
    <div><dt>Confirmed POS settlements</dt><dd>{integer.format(totals.confirmedSettlements)}</dd></div>
    <div><dt>Confirmed payment amount</dt><dd>Unavailable</dd></div>
   </dl>
   <p>The POS handoff records settlement confirmation. Final amounts are available in your POS.</p>
  </section>
 </>;
}

function OrderVolume({report}:{report:AnalyticsReport}){
 const hourly=report.start===report.end;
 const bars=hourly
  ?report.drilldown.hours.map(({hour,orders})=>({label:hourLabel(hour),orders,held:0,showLabel:hour%3===0}))
  :report.days.map(({date,orders,held})=>({label:shortDate.format(new Date(date)),orders,held,showLabel:true}));
 const peak=Math.max(0,...bars.map(bar=>bar.orders));
 const step=Math.max(1,Math.ceil(peak/3));
 const chartMax=step*3;
 const title=hourly?'Orders by hour':'Orders by day';

 return <section className="rd-panel rd-order-chart" aria-labelledby="rd-orders-title">
  <div className="rd-analytics-heading">
   <div><h2 id="rd-orders-title">{title}</h2><p>Order volume in the branch’s time zone.</p></div>
   {peak>0&&!hourly&&<div className="rd-volume-legend">
    <span><i aria-hidden="true"/>Other orders</span>
    <span><i aria-hidden="true"/>Held for review</span>
   </div>}
  </div>
  {peak===0?<p className="rd-analytics-empty">No orders were recorded in this period.</p>:
   <div className="rd-volume-scroll" tabIndex={0} role="region" aria-label={title+' chart'}>
    <div className="rd-chart-body">
     <div className="rd-chart-scale" aria-hidden="true">
      {[chartMax,step*2,step,0].map(value=><span key={value}>{integer.format(value)}</span>)}
     </div>
     <ul className="rd-volume" role="list" style={{gridTemplateColumns:`repeat(${bars.length},minmax(${hourly?20:52}px,1fr))`}}>
      {bars.map(bar=><li className="rd-volume-day" key={bar.label}>
       <div className="rd-volume-track" aria-hidden="true" title={bar.label+' · '+integer.format(bar.orders)+' orders'}>
        <div className="rd-volume-bar" style={{height:`${bar.orders/chartMax*100}%`}}>
         {bar.held>0&&<span style={{height:`${bar.held/bar.orders*100}%`}}/>}
        </div>
       </div>
       <strong className={hourly&&bar.orders===0?'sr-only':undefined}>{integer.format(bar.orders)}<span className="sr-only"> orders{!hourly&&`, ${bar.held} held for review`}</span></strong>
       <span className={bar.showLabel?'rd-volume-label':'sr-only'}>{bar.label}</span>
      </li>)}
     </ul>
    </div>
   </div>}
 </section>;
}

function ReportTable({label,columns,children}:{label:string;columns:string[];children:ReactNode}){
 return <div className="rd-report-scroll" role="region" tabIndex={0} aria-label={label}>
  <table className="rd-report-table" aria-label={label}>
   <thead><tr>{columns.map(column=><th key={column} scope="col">{column}</th>)}</tr></thead>
   <tbody>{children}</tbody>
  </table>
 </div>;
}

function AnalyticsDrilldowns({report}:{report:AnalyticsReport}){
 const {current,previous,previousStart,previousEnd,dailyValue,hours,menu,categories,preparation}=report.drilldown;
 const peak=Math.max(...hours.map(hour=>hour.orders));
 const units=categories.reduce((sum,category)=>sum+category.quantity,0);
 const share=new Intl.NumberFormat('en-IN',{style:'percent',maximumFractionDigits:1});
 return <section aria-labelledby="rd-drilldowns-title" className="rd-drilldowns">
  <h2 id="rd-drilldowns-title">Explore this period</h2>
  <details className="rd-panel rd-drilldown">
   <summary>Orders &amp; estimated value</summary>
   <div className="rd-drilldown-body">
    <p>Previous period: {previousStart} to {previousEnd}. Estimates exclude orders awaiting review, rejected orders and cancellations.</p>
    <ReportTable label="Order period comparison" columns={['Metric','Selected period','Previous period']}>
     {periodMetrics(current).map(([label,value],index)=>{
      const format=(number:number|null)=>number===null?'Unavailable':index===2||index===3?money(number):integer.format(number);
      return <tr key={label}><th scope="row">{label}</th><td>{format(value)}</td><td>{format(periodMetrics(previous)[index]![1])}</td></tr>;
     })}
    </ReportTable>
    <h3>Daily estimated value</h3>
    <ReportTable label="Daily estimated value" columns={['Date','Eligible orders','Estimated value']}>
     {dailyValue.map(day=><tr key={day.date}><th scope="row"><time dateTime={day.date}>{shortDate.format(new Date(day.date))}</time></th>
      <td>{integer.format(day.eligible)}</td><td>{money(day.estimatedMinor)}</td></tr>)}
    </ReportTable>
   </div>
  </details>
  <details className="rd-panel rd-drilldown">
   <summary>Menu performance</summary>
   <div className="rd-drilldown-body">
    <p>Ranked by units ordered. Names and categories use the current menu. Values use prices saved when customers placed their orders.</p>
    {menu.length?<><h3>Items ordered</h3>
     <p>Showing up to 50 items. Expand an item to see how many orders included it.</p>
     <ReportTable label="Menu item performance" columns={['Item','Category','Units','Estimated value']}>
      {menu.map(item=><tr key={item.id}><th scope="row"><details><summary>{item.name}</summary>
       <p>{integer.format(item.orders)} orders included this item.</p></details></th><td>{item.category}</td>
       <td>{integer.format(item.quantity)}</td><td>{money(item.estimatedMinor)}</td></tr>)}
     </ReportTable>
     <h3>Category mix</h3>
     <ReportTable label="Category mix" columns={['Category','Units','Share of units','Estimated value']}>
      {categories.map(category=><tr key={category.name}><th scope="row">{category.name}</th>
       <td>{integer.format(category.quantity)}</td><td>{share.format(category.quantity/units)}</td>
       <td>{money(category.estimatedMinor)}</td></tr>)}
     </ReportTable>
    </>:<p>No eligible menu items in this period.</p>}
   </div>
  </details>
  <details className="rd-panel rd-drilldown">
   <summary>Kitchen performance</summary>
   <div className="rd-drilldown-body">
    <p>Preparation time runs from Preparing to Ready. Tickets missing either timestamp are excluded.</p>
    <dl className="rd-analytics-summary">
     <div><dt>Median preparation time</dt><dd>{timeLabel(preparation.medianSeconds)}</dd></div>
     <div><dt>90th percentile</dt><dd>{timeLabel(preparation.p90Seconds)}</dd></div>
     <div><dt>Timed tickets</dt><dd>{integer.format(preparation.sample)}</dd></div>
    </dl>
    {preparation.sample>0&&<p>The 90th percentile summarizes slower tickets. It is calculated from the timed tickets in this period.</p>}
    <h3>Orders received by hour</h3>
    {peak===0?<p>No orders were recorded in this period.</p>:<>
     <p>Peak order hours: {hours.filter(hour=>hour.orders===peak).map(hour=>hourLabel(hour.hour)).join(', ')} · {report.timezone}</p>
     <ReportTable label="Orders received by branch-local hour" columns={['Hour starting','Orders received']}>
      {hours.map(hour=><tr key={hour.hour}><th scope="row">{hourLabel(hour.hour)}</th><td>{integer.format(hour.orders)}</td></tr>)}
     </ReportTable>
    </>}
   </div>
  </details>
 </section>;
}
