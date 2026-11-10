import type { AccountLeasingData } from '../../shared/account-leasing';

const propertyId='property-one', unitId='unit-one';
const propertyHref=`/properties/${propertyId}`;
const trackerHref=`/available?propertyId=${propertyId}&unitId=${unitId}`;
const viewingsHref=`/available?workspace=viewings&propertyId=${propertyId}`;
const day=(offset:number)=>{const value=new Date();value.setDate(value.getDate()+offset);return value.toISOString().slice(0,10);};
const viewing=(id:string,offset:number,status:string,outcome:string|null)=>({id,propertyId,propertyName:'Market Square',unitId,unitName:'Unit 12',brandId:'brand-one',brandName:'Example Coffee',ownerId:'staff-one',ownerName:'Alex Taylor',date:day(offset),time:'10:30',status,outcome,detailsConfirmed:true,nextAction:null,followUpDate:null,href:`/available?workspace=viewings&propertyId=${propertyId}&viewing=${id}`,propertyHref,trackerHref});
const leasing:AccountLeasingData={checkedAt:new Date().toISOString(),issues:[],
 properties:[{id:propertyId,name:'Market Square',href:propertyHref,trackerHref,viewingsHref,units:[{id:unitId,name:'Unit 12',status:'Available',href:trackerHref,dealHref:'/deals/deal-one'}]}],
 agents:[{userId:'staff-one',name:'Alex Taylor',contexts:[{propertyId,propertyName:'Market Square',role:'Leasing agent',basis:'property_team',href:propertyHref,label:'Property team'}]},{userId:'staff-two',name:'Jordan Lee',contexts:[{propertyId,propertyName:'Market Square',role:'Leasing agent',basis:'deal_record',href:'/deals/deal-one',label:'Deal record'}]}],
 upcomingViewings:[viewing('viewing-one',2,'scheduled',null)],recentViewings:[viewing('viewing-two',-3,'completed','Requested draft lease terms')],
 nextActions:[{taskId:'viewing-action-one',title:'Record viewing feedback — Example Coffee',status:'todo',priority:'normal',dueDate:day(-1),ownerId:'staff-one',ownerName:'Alex Taylor',viewingId:'viewing-two',propertyId,propertyName:'Market Square',href:`/available?workspace=viewings&viewing=viewing-two`,propertyHref,trackerHref}],
};
export const leasingTeams={landlordName:'Example Estates',portfolioCount:1,bgpTeam:[],forSalePropertyIds:[],leasing,
 investment:{flags:{},tracker:[],salesCandidates:[],comps:[],requirements:[],debtEvents:[],sentToThem:[],theirBids:[],theirViewings:[]},
 tenantRep:{space:[],liveRequirements:0,bgpClients:0,deals:[]},leaseAdvisory:{matters:[],events:[],eventsTotal:0},
 agents:[{firmId:'agent-one',name:'Example Agency',roles:{joint_agent:1},represents:[],competing:['Market Square'],deals:1,openDeals:1}],
};
export const leasingWorkspace={team:[],contacts:[],investmentRequirements:[],totals:{deals:1,completedDeals:0},nextActions:[
 {taskId:'viewing-action-one',title:'Record viewing feedback — Example Coffee',status:'todo',priority:'normal',dueDate:day(-1),ownerName:'Alex Taylor',source:'viewing_followup',sourceRef:'viewing_followup:viewing-two',linkKind:'property',linkId:propertyId,linkLabel:'Market Square'},
 {taskId:'general-action-one',title:'Review the latest leasing report',status:'todo',priority:'normal',dueDate:day(1),ownerName:'Jordan Lee',source:null,sourceRef:null,linkKind:'property',linkId:propertyId,linkLabel:'Market Square'},
]};
