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

    opt = opt || {};
    opt.kssOpts = opt.kssOpts || {};

    if ( !opt.templates ) {
      return this.emit( 'error', new PluginError( 'gulp-kss',  'You must supply at least a main template' ));
    }

    var buffer = [];
    var firstFile = null;
    var joinedPath = null;

    /* Is called for each file and writes all files to buffer */
    function bufferContents( file ){
        if (file.isNull()) return; // ignore
        if (file.isStream()) return this.emit( 'error', new PluginError( 'gulp-kss',  'Streaming not supported' ));

        if (!firstFile) firstFile = file;

        buffer.push(file.contents.toString( 'utf8' ));
    }

    /* Is called when all files were added to buffer */
    function endStream(){
        var self = this;
        var contentBuffer = [];
        var content = '';

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
                    id: sectionRoots[ i ].replace( /\./g, '-' ),
                    header: parentSection.header(),
                    childSections: jsonSections( childSections, firstFile.base ),
                    url: path.join( firstFile.base, 'section-' + sectionRoots[ i ] + '.html' )
                };

                // combined sections for master page
                contentBuffer.push( section );
            }

            generateMasterPage.call( self, opt, styleguide, contentBuffer, sectionRoots, firstFile.cwd, firstFile.base );
            generateSectionPages.call( self, opt, styleguide, contentBuffer, sectionRoots, firstFile.cwd, firstFile.base );

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

    function jsonSections(sections, base) {
        var id;
        return sections.map(function(section) {
            id = section.reference().replace( /\./g, '-' );
            return {
                header: section.header(),
                description: section.description(),
                reference: section.reference(),
                id: id,
                depth: section.data.refDepth,
                deprecated: section.deprecated(),
                experimental: section.experimental(),
                modifiers: jsonModifiers(section.modifiers()),
                markup: section.markup() || '',
                url: path.join( base, 'section-' + id + '.html' )
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

    function generateMasterPage( opt, styleguide, sections, sectionRoots, cwd, base ) {
      var template = fs.readFileSync( opt.templates.main, 'utf8' );

      template = handlebars.compile( template );

      // content for master page
      var content = template({
          styleguide: styleguide,
          sections: sections,
          isMaster: true,
          sectionRoots: sectionRoots
      });

      // master page
      this.emit( 'data', new File({
        cwd: cwd,
        base: base,
        path: path.join( base, 'index.html' ),
        contents: new Buffer( content )
      }));
    };

    function generateSectionPages( opt, styleguide, sections, sectionRoots, cwd, base ) {
      var content;
      var self = this;
      var template = fs.readFileSync( opt.templates.section, 'utf8' );

      template = handlebars.compile( template );

      sections.forEach(function( section ){
        // content for section page
        content = template({
            styleguide: styleguide,
            sections: [ section ],
            sectionRoots: sectionRoots
        });

        // section page
        self.emit( 'data', new File({
          cwd: cwd,
          base: base,
          path: section.url,
          contents: new Buffer( content )
        }));

        generateSubsectionPages.call( self, opt, styleguide, section.childSections, sectionRoots, cwd, base );
      });
    };

    function generateSubsectionPages( opt, styleguide, sections, sectionRoots, cwd, base ) {
      var content;
      var self = this;
      var template = fs.readFileSync( opt.templates.subsection, 'utf8' );

      template = handlebars.compile( template );

      sections.forEach(function( section ){
        // content for section page
        content = template({
            styleguide: styleguide,
            sections: [ section ],
            sectionRoots: sectionRoots
        });

        // section page
        self.emit( 'data', new File({
          cwd: cwd,
          base: base,
          path: section.url,
          contents: new Buffer( content )
        }));
      });
    };

    return through(bufferContents, endStream);
};
