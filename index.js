var path = require('path');
var fs = require('fs');
var through = require('through');
var gulp = require('gulp');
var gutil = require('gulp-util');
var gulpless = require('gulp-less');
var kss = require('kss');
var marked = require('marked');
var handlebars = require('handlebars');
var PluginError = gutil.PluginError;
var File = gutil.File;

var handlebarHelpers = require('./handlebarHelpers');

/*
    This script is based and recycles a lot of code of the bin script of kss-node
    https://github.com/hughsk/kss-node/blob/master/bin/kss-node
 */

module.exports = function( opt ) {

    'use strict';

    if (!opt) opt = {};
    if (!opt.templateDirectory) opt.templateDirectory = __dirname + '/node_modules/kss/lib/template';
    if (!opt.kssOpts) opt.kssOpts = {};

    var buffer = [];
    var firstFile = null;
    var joinedPath = null;

    /* Is called for each file and writes all files to buffer */
    function bufferContents( file ){
        if (file.isNull()) return; // ignore
        if (file.isStream()) return this.emit( 'error', new PluginError( 'gulp-kss',  'Streaming not supported' ));

        if (!firstFile) firstFile = file;

        joinedPath = path.join( firstFile.base, 'index.html' );

        buffer.push(file.contents.toString( 'utf8' ));
    }

    /* Is called when all files were added to buffer */
    function endStream(){
        var self = this;
        var template = fs.readFileSync( opt.template, 'utf8' );
        var contentBuffer = [];
        var content = '';

        template = handlebars.compile( template );

        kss.parse( buffer.join( "\n" ), opt.kssOpts, function ( err, styleguide ) {
            if (err) console.log('Error', error);

            var sections = styleguide.section(),
                i = 0,
                sectionCount = sections.length,
                sectionRoots = [],
                childSections = [],
                parentSection,
                currentRoot,
                rootCount,
                section;

            // Accumulate all of the sections' first indexes
            // in case they don't have a root element.
            for ( i = 0; i < sectionCount; i++ ) {
                currentRoot = sections[i].reference().match( /[0-9]*\.?/ )[0].replace( '.', '' );

                if ( !~sectionRoots.indexOf( currentRoot ) ) {
                    sectionRoots.push( currentRoot );
                }
            }

            sectionRoots.sort();
            rootCount = sectionRoots.length;

            handlebarHelpers( handlebars, styleguide );

            // Now, group all of the sections by their root
            for ( i = 0; i < rootCount; i++ ) {
                childSections = styleguide.section( sectionRoots[ i ] + '.*' );
                parentSection = styleguide.section( sectionRoots[ i ] );
                section = {
                    reference: sectionRoots[ i ],
                    header: parentSection.header(),
                    childSections: jsonSections( childSections )
                };

                // combined sections for master page
                contentBuffer.push( section );

                // create path for section page
                joinedPath = path.join( firstFile.base, 'section-' + sectionRoots[ i ] + '.html' );

                // content for section page
                content = template({
                    styleguide: styleguide,
                    sections: [ section ],
                    sectionRoots: sectionRoots
                });

                // section page
                self.emit( 'data', new File({
                  cwd: firstFile.cwd,
                  base: firstFile.base,
                  path: joinedPath,
                  contents: new Buffer( content )
                }));
            }

            // create path for master page
            joinedPath = path.join( firstFile.base, 'index.html' );

            // content for master page
            content = template({
                styleguide: styleguide,
                sections: contentBuffer,
                isMaster: true,
                sectionRoots: sectionRoots
            });

            // master page
            self.emit( 'data', new File({
              cwd: firstFile.cwd,
              base: firstFile.base,
              path: joinedPath,
              contents: new Buffer( content )
            }));

        });
    }

    // duplicate of underscore's _.after() function http://underscorejs.org/docs/underscore.html#section-76
    var underscoreAfter = function underscoreAfter(times, func) {
      return function() {
        if (--times < 1) {
          return func.apply(this, arguments);
        }
      };
    };

    var emitEnd = underscoreAfter(2, function emitEnd(self) {
      self.emit('end');
    });

    function jsonSections(sections) {
        return sections.map(function(section) {
            return {
                header: section.header(),
                description: section.description(),
                reference: section.reference(),
                depth: section.data.refDepth,
                deprecated: section.deprecated(),
                experimental: section.experimental(),
                modifiers: jsonModifiers(section.modifiers()),
                markup: section.markup() || ''
            };
        });
    }

    // Convert an array of `KssModifier` instances to a JSON object.
    function jsonModifiers (modifiers) {
        return modifiers.map(function(modifier) {
            return {
                name: modifier.name(),
                description: modifier.description(),
                className: modifier.className(),
                markup: handlebars.compile( modifier.markup() || '' )({
                    modifier_class: modifier.className() || ''
                })
            };
        });
    }

    return through(bufferContents, endStream);
};
