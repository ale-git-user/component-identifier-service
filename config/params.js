/**
 * Created by ar on 7/16/15.
 */

var dbuser = "root";
var dbpass = "root";
var dbName="idservice";
var host="localhost";

process.argv.forEach(function (val, index, array) {
    var parts = val.split("=");
    if (parts[0] == "dbuser") {
        dbuser = parts[1];
    } else if (parts[0] == "dbpass") {
        dbpass = parts[1];
    }
});

var database={
    host:host,
    user:dbuser,
    pass:dbpass,
    dbname:dbName,
    connectionURL:"mysql://" + dbuser + ":" + dbpass + "@localhost/idservice"
};
module.exports.database=database;
