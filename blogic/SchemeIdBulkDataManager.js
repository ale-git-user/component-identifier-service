/**
 * Created by ar on 7/16/15.
 */
var dbInit=require("../config/dbInit");
var stateMachine=require("../model/StateMachine");
var schemeid=require("../model/schemeid");
var model;
var sets=require('simplesets');
var Sync = require('sync');
var fs = require('fs');
var path=require('path');
var schemes=[];
var generators_path = __dirname + '/SchemeIdGenerator';

fs.readdirSync(generators_path).forEach(function (file) {
    if (~file.indexOf('.js')) {
        var schemeName=path.basename(file, '.js');
        schemes[schemeName.toUpperCase()]=require(generators_path + '/' + file)
    }
});

function getModel(callback) {
    if (model) {
        callback(null);
    } else {
        dbInit.getDB(function (err, pdb, podel1) {
            if (err) {
                callback(err);
            } else {

                model = podel1;
                callback(null);
            }
        })
    }
}

var throwErrMessage=function(msg){
    var err={};
    err.message=msg;
    return err;
};

var getSchemeIds=function (scheme, schemeIdArray, callback) {

    schemeIdArray.forEach(function (schemeId) {
        if (schemeId == null || schemeId == "") {
            callback(throwErrMessage("SchemeId is null."), null);
            return;
        } else {

            if (!schemes[scheme.toUpperCase()].validSchemeId(schemeId)) {

                callback(throwErrMessage("Not valid schemeId:" + schemeId), null);
                return;
            }
        }
    });
    var objQuery = {scheme: scheme.toUpperCase(), schemeId: schemeIdArray};
    schemeid.findByIds(objQuery, function (err, schemeIdRecords) {
        if (err) {
            callback(err, null);
            return;
        }
        var resArray = [];
        schemeIdRecords.forEach(function (schemeIdRecord) {
            resArray.push(schemeIdRecord.schemeId);
        });
        var rA = new sets.StringSet(resArray);
        var rQ = new sets.StringSet(schemeIdArray);
        var diff = rQ.difference(rA).array();
        if (diff && diff.length > 0) {
            var cont = 0;
            diff.forEach(function (schemeId) {

                getFreeRecord(scheme, schemeId, null, function (err, record) {
                    if (err) {
                        callback(err, null);
                    } else {
                        cont++;
                        schemeIdRecords.push(record);
                        if (cont == diff.length) {
                            callback(null, schemeIdRecords);
                            return;
                        }
                    }
                });
            });
        } else {
            callback(null, schemeIdRecords);
        }
    });
};

function getFreeRecord(scheme, schemeId, systemId, callback){
    Sync(function() {
        try {
            var schemeIdRecord = getNewRecord(scheme, schemeId, systemId);
            schemeIdRecord.status = stateMachine.statuses.available;
            var newRecord = insertSchemeIdRecord.sync(null, schemeIdRecord);

            callback(null, newRecord);
        }catch(e){
            callback(e,null);
        }
    });
}
function getNewRecord(scheme, schemeId, systemId){
    var schemeIdRecord= {
        scheme: scheme.toUpperCase(),
        schemeId: schemeId,
        sequence: schemes[scheme.toUpperCase()].getSequence( schemeId),
        checkDigit: schemes[scheme.toUpperCase()].getCheckDigit( schemeId)
    };
    if (systemId) {
        schemeIdRecord.systemId = systemId;
    }else{
        schemeIdRecord.systemId = guid();
    }
    return schemeIdRecord;
}

var getSchemeIdBySystemIds=function (scheme, systemIds, callback) {
    var objQuery = {scheme: scheme.toUpperCase(), systemId: systemIds};
    schemeid.findBySystemIds(objQuery, function (err, schemeIdRecords) {
        if (err) {
            callback(err, null);
        }
        callback(null, schemeIdRecords);
    });
};

var getSyncSchemeIdBySystemId=function (scheme, systemId, callback) {
    Sync(function () {
        var objQuery = {scheme: scheme.toUpperCase(), systemId: systemId};
        try {
            var schemeIdRecord = schemeid.findBySystemId.sync(null, objQuery);
            if (!schemeIdRecord || schemeIdRecord.length==0) {
                callback(null, null);
            } else {
                callback(null, schemeIdRecord[0]);
            }
        } catch (e) {
            callback(e, null);
        }
    });
};

var registerSchemeIds=function ( operation, callback) {
    Sync(function () {
        try {
            var cont = 0;
            var records = [];
            var error = false;
            var scheme = operation.scheme;
            for (var i = 0; i < operation.records.length; i++) {
                var schemeId = operation.records[i].schemeId;
                var systemId = operation.records[i].systemId;
                if (error) {
                    break;
                }
                var schemeIdRecord = getSchemeId.sync(null, scheme, schemeId, systemId);

                if (error) {
                    return;
                }

                if (schemeIdRecord.schemeId == schemeId && schemeIdRecord.systemId != systemId) {
                    schemeIdRecord.systemId = systemId;
                }
                var newStatus;
                if (schemeIdRecord.status==stateMachine.statuses.assigned){
                    newStatus=stateMachine.statuses.assigned;
                }else {
                    newStatus = stateMachine.getNewStatus(schemeIdRecord.status, stateMachine.actions.register);
                }
                if (newStatus) {

                    schemeIdRecord.status = newStatus;
                    schemeIdRecord.author = operation.author;
                    schemeIdRecord.software = operation.software;
                    schemeIdRecord.expirationDate = operation.expirationDate;
                    schemeIdRecord.comment = operation.comment;
                    schemeIdRecord.jobId = operation.jobId;

                    records.push(schemeIdRecord);
                    cont++;
                    if (cont == operation.records.length) {
                        cont = 0;
                        for (var j = 0; j < records.length; j++) {

                            schemeid.save(records[j],function (err) {
                                if (err) {
                                    error = true;
                                    callback(err);
                                    return;
                                }
                                cont++;
                                if (cont == records.length) {
                                    callback(null);
                                    return;

                                }

                            });
                        }
                    }
                } else {
                    error = true;
                    callback("Cannot register SchemeId:" + schemeIdRecord.schemeId + ", current status: " + schemeIdRecord.status);
                    return;
                }

            }
        } catch (e) {
            callback(e.message);
        }
    });

};
var updateSchemeIds=function ( operation, callback){
    var cont=0;
    var records=[];
    var error=false;
    var scheme=operation.scheme;
    for (var i=0;i<operation.schemeIds.length;i++) {
        var SchemeId = operation.schemeIds[i];
        if (error) {
            break;
        }
        getSchemeId(scheme, SchemeId, null, function (err, schemeIdRecord) {
            if (error) {
                return;
            }
            if (err) {
                error = true;
                callback(err);
                return;
            } else {


                var newStatus = stateMachine.getNewStatus(schemeIdRecord.status,operation.action);
                if (newStatus) {

                    schemeIdRecord.status = newStatus;
                    schemeIdRecord.author = operation.author;
                    schemeIdRecord.software = operation.software;
                    schemeIdRecord.comment = operation.comment;
                    schemeIdRecord.jobId = operation.jobId;
                    records.push(schemeIdRecord);
                    cont++;
                    if (cont == operation.schemeIds.length) {
                        cont = 0;
                        for (var j = 0; j < records.length; j++) {

                            schemeid.save(records[j], function (err) {
                                if (err) {
                                    error = true;
                                    callback(err);
                                    return;
                                }
                                cont++;
                                if (cont == records.length) {
                                    callback(null);
                                    return;

                                }

                            });
                        }
                    }
                } else {
                    error = true;
                    callback("Cannot " + operation.action + " SchemeId:" + schemeIdRecord.schemeId + ", current status: " + schemeIdRecord.status);
                    return;
                }
            }
        });
    }
};

var getSchemeId=function (scheme, schemeId, systemId, callback) {
    Sync(function () {
        if (!schemes[scheme.toUpperCase()].validSchemeId(schemeId)){

            callback("Not valid SchemeId: " + schemeId, null);
            return;
        }
        var objQuery = {scheme: scheme, schemeId: schemeId};
        var schemeIdRecord = schemeid.findById.sync(null, objQuery);
        if (!schemeIdRecord) {
            try {
                var record = getFreeRecord.sync(null, scheme, schemeId, systemId);

                callback(null, record);
            }catch(e){
                callback(e,null);
            }
        } else {

            callback(null, schemeIdRecord);
        }
    });
};


function insertSchemeIdRecord(newSchemeIdRecord, callback){
    Sync(function() {
        try {
            var newSchemeIdRecord2 = schemeid.create.sync(null, newSchemeIdRecord);
            callback(null, newSchemeIdRecord2);
        }catch(e){
            callback(e,null);
        }
    });
}

var guid = (function() {
    function s4() {
        return Math.floor((1 + Math.random()) * 0x10000)
            .toString(16)
            .substring(1);
    }
    return function() {
        return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
            s4() + '-' + s4() + s4() + s4();
    };
})();


function generateSchemeId( operation, thisScheme, callback){
    Sync(function() {
        try{

            var rec=setAvailableSchemeIdRecord2NewStatus.sync(null, operation, thisScheme);
            if (!rec) {
                setNewSchemeIdRecord.sync(null, operation, thisScheme);
            }
            callback(null);

        } catch (e) {
            callback(e);
        }
    });
};

function setAvailableSchemeIdRecord2NewStatus(operation, thisScheme, callback){
    Sync(function () {
        try {
            var query = {scheme: thisScheme.scheme.toUpperCase(), status: stateMachine.statuses.available};

            var schemeIdRecords=schemeid.find.sync(null,query,1,null);
            if (schemeIdRecords && schemeIdRecords.length > 0) {

                var action = operation.action;
                var newStatus = stateMachine.getNewStatus(schemeIdRecords[0].status, action);

                if (newStatus) {

                    if (operation.systemId && operation.systemId.trim() != "") {
                        schemeIdRecords[0].systemId = operation.systemId;
                    }
                    schemeIdRecords[0].status = newStatus;
                    schemeIdRecords[0].author = operation.author;
                    schemeIdRecords[0].software = operation.software;
                    schemeIdRecords[0].expirationDate = operation.expirationDate;
                    schemeIdRecords[0].comment = operation.comment;
                    schemeIdRecords[0].jobId = operation.jobId;
                    schemeid.save.sync(null,schemeIdRecords[0]);
                    callback(null, true);
                } else {
                    callback(null, false);
                }
            } else {
                callback(null, false);
            }
        } catch (e) {
            var error = "error:" + e;
            console.error(error); // something went wrong
            callback(error, null);
        }
    });
}

function setNewSchemeIdRecord(operation, thisScheme, callback) {
    Sync(function () {
        try {

            var previousCode=thisScheme.idBase;
            var newSchemeId=schemes[thisScheme.scheme.toUpperCase()].getNextId(previousCode);
            thisScheme.idBase=newSchemeId;
            var scheme=thisScheme.scheme;

            var systemId ;
            var action=operation.action;
            if (operation.systemId && operation.systemId.trim() != "") {
                systemId = operation.systemId;
            }
            var schemeIdRecord = getSchemeId.sync(null, scheme, newSchemeId,systemId);


            var newStatus = stateMachine.getNewStatus(schemeIdRecord.status, action);
            if (newStatus) {

                schemeIdRecord.status = newStatus;
                schemeIdRecord.author = operation.author;
                schemeIdRecord.software = operation.software;
                schemeIdRecord.expirationDate = operation.expirationDate;
                schemeIdRecord.comment = operation.comment;
                schemeIdRecord.jobId=operation.jobId;
                schemeid.save.sync(null, schemeIdRecord);
                callback(null);
            } else {
                setNewSchemeIdRecord.sync(null, operation, thisScheme);
                callback(null);
            }
        } catch (e) {
            var error="error:" + e;
            console.error(error); // something went wrong
            callback(error);
        }
    });
};

function getScheme(key,callback) {
    model.schemeIdBase.get(key, function (err, scheme) {
        if (err) {
            callback(err, null);
        } else {
            if (!scheme) {
                callback("Scheme not found for key:" + JSON.stringify(key), null);
            } else {
                callback(null, scheme);
            }
        }
    });
};

var generateSchemeIds=function ( operation, callback) {
    getModel(function (err) {
        if (err) {
            console.log("error model:" + err);
            callback(err);
        } else {
            var cont = 0;
            var key = operation.scheme;

            getScheme(key, function (err, data) {
                if (err) {
                    callback(err);
                } else {
                    if (!data) {
                        callback("Scheme not found for key:" + JSON.stringify(key));
                    }
                    var thisScheme = data;
                    Sync(function () {
                        var canContinue;
                        for (var i = 0; i < operation.quantity; i++) {
                            canContinue = true;
                            try {

                                operation.systemId = operation.systemIds[i];
                                if (!operation.autoSysId) {
                                    var schemeIdRecord = getSyncSchemeIdBySystemId.sync(null, thisScheme.scheme, operation.systemId);
                                    if (schemeIdRecord != null) {
                                        schemeIdRecord.jobId = operation.jobId;
                                        schemeid.save.sync(null, schemeIdRecord);
                                        canContinue = false;

                                    }
                                }
                                if (canContinue) {
                                    generateSchemeId.sync(null, operation, thisScheme);
                                }
                                cont++;
                                if (operation.quantity == cont) {
                                    thisScheme.save(function (err) {
                                        if (err) {
                                            callback(err);
                                        } else {
                                            callback(null);
                                        }
                                    });
                                }
                            } catch (e) {
                                console.error("generateSchemeIds error:" + e); // something went wrong
                                callback(e);
                            }
                        }

                    });
                }
            });
        }
    });
};

module.exports.generateSchemeIds=generateSchemeIds;
module.exports.registerSchemeIds=registerSchemeIds;
module.exports.getSchemeIdBySystemIds=getSchemeIdBySystemIds;
module.exports.getSchemeIds=getSchemeIds;
module.exports.updateSchemeIds=updateSchemeIds;