/**
 * CDH Connector Logs Viewer Ex
 * Created by kiyoshi.amano@tealium.com
 * Date: Jul 08, 2021
 * Version: 0.9
 * Change Log:
 */

"use strict";

// namespace Krcl = Kindred Connector Logs
function Krcl() {
    // init event handlers for handlebarjs template
    // mapping of event <--> event handler
    // usage in handlebars template
    // tealiumTools.invokeFunction('{{event.onFormSubmit}}', params);
    this.events = {
        onKrclFormSubmit: 'krclFormSubmit',
        onKrclRowSelect: 'krclRowSelect',
        onKrclErrorLimitChange: 'krclErrorLimitChange',
        onKrclBack: 'krclBack'
    };

    this.ACCOUNT = window.gApp ? gApp.inMemoryModels.account : null;
    this.PROFILE = window.gApp ? gApp.inMemoryModels.profile : null;
}

Krcl.prototype.initSearchPage = function () {
    // helper
    function base64EncodeUnicode(str) {
        // First we escape the string using encodeURIComponent to get the UTF-8 encoding of the characters, 
        // then we convert the percent encodings into raw bytes, and finally feed it to btoa() function.
        var utf8Bytes = encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function (match, p1) {
            return String.fromCharCode('0x' + p1);
        });

        return btoa(utf8Bytes);
    }

    // prerequisite checks
    if (document.URL.indexOf('.tealiumiq.com/datacloud') === -1) {
        this.reportError('This tool can only be run in CDH website');
        return;
    }

    if (typeof localStorage.utk === 'undefined') {
        this.reportError('No utk is available');
        return;
    }

    if (_store.connectors.items.length == 0) {
        this.reportError('No connector configured in this profile');
        return;
    }

    var connectorsInfo = this.getConnectorsInfo();

    tealiumTools.send({
        data: {
            connectorsInfo: connectorsInfo,
            connectorsInfoString: base64EncodeUnicode(JSON.stringify(connectorsInfo)),
            hasConnector: Object.keys(connectorsInfo).length > 0
        },
        event: this.events,
        ui: {
            search: true
        }
    });
}

Krcl.prototype.getConnectorsInfo = function () {
    var enabled = {
        true: 'Enabled',
        false: 'Disabled'
    };
    var models = _store.connectors.items.slice();
    var out = {};

    for (var model of models) {
        var connectorTitle = `${enabled[model.enabled]} | ${model.type} | ${model.name}`;
        out[model.id] = {
            title: connectorTitle,
            actions: model.actionItems.map(item => {
                return {
                    id: item.id,
                    title: `${item.id} | ${item.name}`
                }
            })
        }
    }

    return out;
}

Krcl.prototype.getConnectorSummaryLogs2 = async function(requests, connMap, actMap, utcTime) {

    // Run all the requests asynchronously
    const responses = 
            await Promise.all(
                requests.map(request => fetch(request)
                            .then(response => {
                                if(response.ok){
                                    return response.json();
                                }else{
                                    return {"error": response.status}
                                }
                            })
                        )
                    );

    // aggregate data
    var aggData = {};
    responses.forEach(function(res, index, array){
        res.forEach(function(r,j,a){
            let st = new Date(r.start_time);
            st = utcTime ? st : st.setMinutes(st.getMinutes + (0.0 - st.getTimezoneOffset()));

            console.log(`** st ** : ${st}`);

            const dt   = st.toLocaleDateString().substr(0,10);

            console.log(`** dt ** : ${dt}`);

            const conn = r.vendor_id;
            const act  = r.action_id;
            
            const k = dt + '@' + conn + '@' + act;

            if(typeof aggData[k] !== 'undefined'){
                aggData[k].success += r.success_count;
                aggData[k].error += r.error_count;
            }
            else{
                aggData[k] = {
                   'success': r.success_count, 
                   'error': r.error_count, 
                };
            }
        })
    });

    var data = [];
    for(let k in aggData){
        if(k.indexOf('@') >=0 && k.split('@').length >= 3){
            let d = {};
            d['date'] = k.split('@')[0];
            d['connector'] = connMap[k.split('@')[1]];
            d['action'] = actMap[k.split('@')[2]];
            d['success'] = aggData[k]['success'];
            d['error'] = aggData[k]['error'];

            data.push(d);
        }
    }

    const today = new Date();
    const y = today.getFullYear();
    const m = ('0' + (today.getMonth() + 1)).slice(-2);
    const d = ('0' + today.getDate()).slice(-2);
    const h = ('0' + today.getHours()).slice(-2);
    const mi = ('0' + today.getMinutes()).slice(-2);
    const s = ('0' + today.getSeconds()).slice(-2);
    const out_date = y + '' + m + '' + d + '' + h + '' + mi + '' + s;

    tealiumTools.send({
        data: {
            logsOverview: data,
            logsOverviewString: JSON.stringify(data),
            success: data.reduce((acc, cur) => { return acc + cur.success }, 0),
            error: data.reduce((acc, cur) => { return acc + cur.error }, 0),
            filename: ['connectorLogs2', krcl.ACCOUNT, krcl.PROFILE, out_date].join('-') + '.csv'
        },
        event: krcl.events,
        ui: {
            overview: true
        }
    });
}

// --- HANDLEBARS EVENT HANDLERS --- //
function krclFormSubmit({ connMap, actMap, actionIds, from, to, errorOnly, utcTime, errorFlag }) {

    // Validate input values
    if(errorFlag == 1){
        tealiumTools.sendError('Error', 'Action(s) must be selected.');
        return;
    }
    else if(errorFlag == 2){
        tealiumTools.sendError('Error', 'From or To (or both) dates are invalid');
        return;
    }
    else if(errorFlag == 3){
        tealiumTools.sendError('Error', 'To date must be after From date');
        return;
    }


    const account = gApp.inMemoryModels.account;
    const profile = gApp.inMemoryModels.profile;
    const utk = localStorage.utk;

    // create requests
    const reqUrls = [];
    actionIds.forEach(function(complexId, index, array){

        if(complexId.indexOf("@") >= 0 && complexId.split("@").length >= 2){
            const connectorId = complexId.split('@')[0];
            const actionId = complexId.split('@')[1];
            const endpoint = `https://${location.hostname}/urest/datacloud/${account}/${profile}/audit/${connectorId}/${actionId}`;

            const reqUrl = new URL(endpoint);
            reqUrl.search = new URLSearchParams({
                utk: utk,
                start: (new Date(from).toISOString()),
                end: (new Date(to).toISOString()),
                utcTime: utcTime
            });
            reqUrls.push(reqUrl);
        }
    });

    // request to get connector logs
    krcl.getConnectorSummaryLogs2(reqUrls, connMap, actMap, utcTime);
}

function krclBack() {
    // always go back to search page
    krcl.initSearchPage();
}

// ---  MAIN --- //
window.krcl = window.krcl || new Krcl();
krcl.initSearchPage();