/**
 * UDH Connector Logs Viewer Ex
 * Created by kiyoshi.amano@tealium.com
 * Date: 06/07/2021
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

    this.DEFAULT_ERROR_LIMIT = 10;
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
        this.reportError('This tool can only be run in UDH website');
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

Krcl.prototype.getErrorLimitOptions = function () {
    return [5, 10, 25, 50, 100];
}

Krcl.prototype.getConnectorSummaryLogs = async function ({ connectorId, actionId, start, end, utcTime }) {
    var account = gApp.inMemoryModels.account;
    var profile = gApp.inMemoryModels.profile;
    var utk = localStorage.utk;

    const endpoint = `https://${location.hostname}/urest/datacloud/${account}/${profile}/audit/${connectorId}/${actionId}`;

    var url = new URL(endpoint);
    url.search = new URLSearchParams({
        utk: utk,
        start: start,
        end: end
    });

    var data = [];
    try {
        var response = await fetch(url);
        if (!response.ok) throw new Error('Invalid request');
        data = await response.json();
    } catch (err) {
        // do nothing
    }

    // touch up data
    data = data.map(row => {
        var startDate = new Date(row.start_time);
        var endDate = new Date(row.end_time);
        return {
            start: utcTime ? startDate.toISOString() : startDate.toLocaleDateString() + ' ' + startDate.getHours() + ':00',
            end: utcTime ? endDate.toISOString() : endDate.toLocaleDateString() + ' ' + endDate.getHours() + ':00',
            success: row.success_count,
            error: row.error_count,
            hidden: `${connectorId}|${actionId}|${row.start_time}|${row.end_time}|${row.error_count}`,
            endpoint: this.getErrorEndpoint(connectorId, actionId, row.start_time, row.end_time)
        }
    });

    return data;
}

Krcl.prototype.getConnectorSummaryLogs2 = async function(requests) {

    console.log("------ getConnectorSummaryLogs2 -------");

    // Run all the requests asynchronously
    const responses = 
            await Promise.all(requests.map(request => fetch(request)
                                            .then(response => {
                                                if(response.ok){
                                                    return response.json();
                                                }else{
                                                    return {"error": response.status}
                                                }
                                            })
                                        )
                                    );

    // debug
    console.log(`length of responses : ${responses.length}`);
    responses.forEach(function(res, index, array){
        console.log(`${index} : ${JSON.stringify(res)}`);
    })
}



Krcl.prototype.getConnectorErrorLogs = async function ({ connectorId, actionId, start, end, limit }) {
    var url = this.getErrorEndpoint(connectorId, actionId, start, end, limit);
    var data = [];
    try {
        var response = await fetch(url);
        if (!response.ok) throw new Error('Invalid request');
        data = await response.json();
    } catch (err) {
        // do nothing
    }

    // touch up data
    data = data.map(row => {
        row.time = (new Date(row.time)).toLocaleString();
        row.message = row.message.split(';');
        // do we have Action Time in last row?
        var lastMsg = row.message[row.message.length - 1];
        if (lastMsg.includes('Action Time:')) {
            row.actionTime = lastMsg.split(':')[1].trim();
        }
        return row;
    });

    return {
        url: url.toString(),
        errors: data
    };
}

Krcl.prototype.reportError = function (msg) {
    tealiumTools.send({
        data: {
            error: msg,
        },
        ui: {
            error: true
        }
    });
}

Krcl.prototype.getErrorEndpoint = function (connectorId, actionId, start, end, limit) {
    var account = gApp.inMemoryModels.account;
    var profile = gApp.inMemoryModels.profile;
    var utk = localStorage.utk;

    const endpoint = `https://${location.hostname}/urest/datacloud/${account}/${profile}/audit/${connectorId}/${actionId}/errors`;

    var url = new URL(endpoint);
    url.search = new URLSearchParams({
        utk: utk,
        start: start,
        end: end,
        limit: limit || this.DEFAULT_ERROR_LIMIT
    });

    return url.toString();
}

// --- HANDLEBARS EVENT HANDLERS --- //
function udhclFormSubmit({ connectorId, actionId, from, to, errorOnly, utcTime }) {
    if (!connectorId || !actionId) {
        tealiumTools.sendError('Error', 'Connector ID and Action ID is required.');
        return;
    }

    // note date range will be set default from UI
    // in format of string - yyyy-mm-ddThh:mm
    if (!from || !to) {
        tealiumTools.sendError('Error', 'Date range is required.');
        return;
    }

    var params = {
        connectorId: connectorId,
        actionId: actionId,
        start: (new Date(from).toISOString()),
        end: (new Date(to).toISOString()),
        utcTime: utcTime
    };

    udhcl.getConnectorSummaryLogs(params).then(data => {
        if (errorOnly) {
            data = data.filter(row => row.error > 0);
        }

        if (!data || data.length == 0) {
            tealiumTools.sendError('Error', 'No connector log found for selected criteria');
            return;
        }
        tealiumTools.send({
            data: {
                logsOverview: data,
                logsOverviewString: JSON.stringify(data),
                success: data.reduce((acc, cur) => { return acc + cur.success }, 0),
                error: data.reduce((acc, cur) => { return acc + cur.error }, 0),
                filename: ['connectorLogs', krcl.ACCOUNT, krcl.PROFILE, params.actionId].join('-') + '.csv'
            },
            event: krcl.events,
            ui: {
                overview: true
            }
        });
    });
}

function krclFormSubmit({ connMap, actMap, actionIds, from, to, errorOnly, utcTime }) {
    console.log("----- krclFormSubmit ----------");

    if (!actionIds) {
        tealiumTools.sendError('Error', 'Action(s) must be selected.');
        return;
    }

    // note date range will be set default from UI
    // in format of string - yyyy-mm-ddThh:mm
    if (!from || !to) {
        tealiumTools.sendError('Error', 'Date range is required.');
        return;
    }

    console.log(`actionIds : ${actionIds}`);
    console.log(`from : ${from}`);
    console.log(`to : ${to}`);
    console.log('/// connMap ////');
    for(let c in connMap){
        console.log(`${c}:${connMap[c]}`);
    }
    console.log('/// actMap ////');
    for(let a in actMap){
        console.log(`${a}:${actMap[a]}`);
    }

    const account = gApp.inMemoryModels.account;
    const profile = gApp.inMemoryModels.profile;
    const utk = localStorage.utk;

    console.log(`account = ${account}`);
    console.log(`profile = ${profile}`);
    console.log(`utk = ${utk}`);

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

    // debug
    console.log(`request urls length : ${reqUrls.length}`);
    console.log(`request urls : ${reqUrls}`);

    /*
    var params = {
        actionIds: actionIds,
        start: (new Date(from).toISOString()),
        end: (new Date(to).toISOString()),
        utcTime: utcTime
    };
    */

    krcl.getConnectorSummaryLogs2(reqUrls);
}




function udhclRowSelect(params) {
    udhcl.getConnectorErrorLogs(params).then(data => {
        if (!data || data.errors.length == 0) {
            tealiumTools.sendError('Error', `No data returned from API ${data.url}`);
            return;
        }
        tealiumTools.send({
            data: {
                url: data.url,
                errorLimitOptions: krcl.getErrorLimitOptions(),
                errorLimit: params.limit || krcl.DEFAULT_ERROR_LIMIT,
                errors: data.errors,
                count: data.errors.length,
                existingParamsString: JSON.stringify(params),
            },
            event: krcl.events,
            ui: {
                detail: true
            }
        });
    });
}

function krclErrorLimitChange(params) {
    // just like a row select but with 'limit' parameters
    krclRowSelect(params);
}

function krclBack() {
    // always go back to search page
    krcl.initSearchPage();
}

// ---  MAIN --- //
window.krcl = window.krcl || new Krcl();
krcl.initSearchPage();