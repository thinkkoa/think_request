/**
 * @ author: richen
 * @ copyright: Copyright (c) - <richenlin(at)gmail.com>
 * @ license: MIT
 * @ version: 2020-05-19 13:31:13
 */
const helper = require('think_lib');
const logger = require('think_logger');
const retry = require('bluebird-retry');
const requestp = require('request-promise');
const aRequestP = requestp.defaults({
    family: 4,
    resolveWithFullResponse: true,
    agent: false,
    pool: { maxSockets: Infinity }, // maxSockets: Infinity
    forever: true,
    strictSSL: false
});
const dns = require('dns');
const urlLib = require('url');
const DNS_CACHE = { timeout: 0 };
const dnsLookup = helper.promisify(dns.lookup, dns);


/**
 *
 *
 * @param {*} [form={}]
 * @param {*} uri
 * @param {string} [method='GET']
 * @param {*} [headers={}]
 * @param {boolean} [json=true]
 * @param {number} [timeout=10000]
 * @param {number} [maxTries=1]
 * @param {boolean} [dnsCache=false]
 * @returns
 */
module.exports = async function (form = {}, uri, method = 'GET', headers = {}, json = true, timeout = 10000, maxTries = 1, dnsCache = false) {
    const now = Date.now();
    const options = { uri, timeout };
    if (json) {
        options.json = true; // Automatically parses the JSON string in the response
    }
    // custom headers
    options.headers = Object.assign({
        'User-Agent': 'request/2.88.2',
        'Accept': '*/*'
    }, headers);

    // enable dns cache
    let promisea = Promise.resolve({ newUri: uri, hostname: '' });
    if (dnsCache) {
        if (!DNS_CACHE[uri] || now > DNS_CACHE.timeout) {
            DNS_CACHE.timeout = now + 3600000; //one hour
            const hostInfo = urlLib.parse(uri);
            // tslint:disable-next-line: no-null-keyword
            const info = await dnsLookup(hostInfo.hostname).catch(() => null);
            if (info && hostInfo.hostname) {
                hostInfo.port = hostInfo.port ? `:${hostInfo.port}` : '';
                const newUri = `${hostInfo.protocol}//${info}${hostInfo.port}${hostInfo.path}`;
                DNS_CACHE[uri] = { newUri, hostname: hostInfo.hostname };
                promisea = Promise.resolve(DNS_CACHE[uri]);
            } else {
                promisea = Promise.resolve({ newUri: uri, hostname: '' });
            }
        } else {
            promisea = Promise.resolve(DNS_CACHE[uri]);
        }
        // replace uri
        // tslint:disable-next-line: no-null-keyword
        const dnsInfo = await promisea.catch(() => null);
        if (dnsInfo && dnsInfo.newUri) {
            options.uri = dnsInfo.newUri;
            if (dnsInfo.hostname) {
                options.headers.Host = dnsInfo.hostname;
            }
        }
    }

    if (method.toUpperCase() === 'GET') {
        options.qs = form;
        options.method = 'GET';
    } else {
        const contentType = helper.toString(headers['Content-Type']);
        if (contentType.indexOf('json') > -1) {
            if (options.json) {
                options.body = form;
            } else {
                options.body = JSON.stringify(form);
            }
        } else if (headers['Form-data'] || (contentType.indexOf('form-data') > -1)) {
            options.formData = form;
        } else {
            options.form = form;
        }
        //
        options.method = method;
    }

    if (maxTries > 1) {
        const retryOption = {
            interval: 50, //重试时间间隔
            timeout: 60000, //总耗时长
            max_tries: maxTries //最大重试次数
        };
        return retry(function () {
            // request
            return aRequestP(options).then((res) => {
                return res.body;
            });
        }, retryOption).caught(function (err) {
            try {
                if (err.failure) {
                    err.statusCode = err.failure.statusCode;
                    err.message = err.failure.message;
                }
                if (err.message && err.message.indexOf('{') > -1) {
                    err = JSON.parse(err.message.match(/{.*}$/)[0]);
                }
            } catch (e) { }

            logger.write(process.env.LOGS_PATH, 'THINK_REQUEST', JSON.stringify({ options, code: err.statusCode || '', message: err.message }));
            if (err.message && helper.toString(err.message).indexOf('TIMEDOUT') > -1) {
                return Promise.reject({ code: 504, message: err.message });
            }
            return Promise.reject({ code: err.statusCode || 503, message: err.message });
        }).then((res) => {
            return res.body;
        });
    } else {
        // request
        return aRequestP(options).then((res) => {
            return res.body;
        }).catch((err) => {
            logger.write(process.env.LOGS_PATH, 'THINK_REQUEST', JSON.stringify({ options, code: err.statusCode || '', message: err.message }));
            if (err.message && helper.toString(err.message).indexOf('TIMEDOUT') > -1) {
                return Promise.reject({ code: 504, message: err.message });
            }
            return Promise.reject({ code: err.statusCode || 503, message: err.message });
        });
    }
};