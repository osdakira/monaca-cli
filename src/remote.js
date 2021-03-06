(function() {
'use strict';

var path = require('path'),
  open = require('open'),
  argv = require('optimist').argv,
  shell = require('shelljs'),
  Monaca = require('monaca-lib').Monaca,
  Q = require('q'),
  lib = require(path.join(__dirname, 'lib')),
  util = require(path.join(__dirname, 'util'));

var monaca = new Monaca();

var RemoteTask = {};

RemoteTask.run = function(taskName) {
  monaca.prepareSession().then(
    function() {
      var task = argv._[1];

      if (task === 'build') {
        this.build();
      } else {
        util.fail('No such command.');
      }
    }.bind(this),
    util.displayLoginErrors
  );
};

RemoteTask.build = function() {
  var params = {};
  params.platform = argv._[2];
  params.purpose = argv['build-type'] || 'debug';

  ['browser', 'android_webview', 'android_arch', 'output']
  .forEach(function(property) {
    if (argv.hasOwnProperty(property)) {
      params[property] = argv[property];
    }
  });

  if (!params.browser && (!params.platform || !params.purpose)) {
    util.fail('Missing parameters. Please write --help to see the correct usage.');
  }

  var cwd, projectInfo;

  lib.confirmOverwrite({action: 'upload'})
    // Waiting for user permission.
    .then(
      function() {
        return lib.findProjectDir(process.cwd(), monaca);
      },
      util.fail
    )
    // Checking project directory.
    .then(
      function(directory) {
        cwd = directory;
        util.print('Uploading project to Monaca Cloud...');
        return lib.assureMonacaProject(cwd, monaca);
      },
      util.fail
    )
    // Assuring this is a Monaca-like project.
    .then(
      function(info) {
        projectInfo = info;
        return monaca.uploadProject(cwd);
      },
      util.fail.bind(null, 'Unable to create monaca project: ')
    )
    // Uploading project to Monaca Cloud.
    .then(
      function(files) {
        lib.printSuccessMessage({action: 'upload'}, files);
        if (!params.browser) {
          return monaca.checkBuildAvailability(projectInfo.projectId, params.platform, params.purpose);
        }
      },
      util.fail.bind(null, 'Upload failed: '),
      util.displayProgress
    )
    // Checking build availabilty (if no browser).
    .then(
      function() {
        if (argv.browser) {
          var url = 'https://ide.monaca.mobi/project/' + projectInfo.projectId + '/' + (argv['debugger'] ? 'debugger' : 'build');
          return monaca.getSessionUrl(url).then(
            function(url) {
              open(url, function() {
                process.exit(0);
              });
              return Q.defer().promise;
            },
            util.fail.bind(null, 'Unable to open build page: ')
          );
        } else {
          // Build project on Monaca Cloud and download it into ./build folder.
          util.print('\nBuilding project on Monaca Cloud...');
          return monaca.buildProject(projectInfo.projectId, params);
        }
      },
      util.fail.bind(null, 'Unable to build this project: ')
    )
    // Building the project remotely.
    .then(
      function(result) {
        return result.binary_url ? monaca.getSessionUrl(result.binary_url) : util.fail(result.error_message);
      },
      util.fail,
      util.displayProgress
    )
    // Getting session URL.
    .then(
      function(sessionUrl) {
        return monaca.download(sessionUrl, {}, function(response) {
          if (params.output) {
            return path.resolve(params.output);
          }

          var filename = 'output.bin';
          if (typeof response.headers['content-disposition'] === 'string') {
            var regexMatch = response.headers['content-disposition'].match(/filename="?([^"]+)"?/);
            if (regexMatch) {
              filename = regexMatch[1];
            }
          }

          shell.mkdir('-p', path.join(cwd, 'build'));
          return path.join(cwd, 'build', filename);
        });
      },
      util.fail
    )
    // Downloading binary file from Monaca Cloud.
    .then(
      function(filepath) {
        util.success('\n\nYour package is stored at ' + filepath);
      },
      util.fail.bind(null, '\n')
    );
};

module.exports = RemoteTask;
})();
