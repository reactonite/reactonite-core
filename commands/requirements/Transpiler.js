const path = require("path");
const fs = require("fs");
const NodeWrapper = require("./NodeWrapper");
var cheerio = require("cheerio");
const fse = require("fs-extra");

class ReactCodeMapper {
  /**
   * Class to convert tags and props from HTML to React

    Call getReactMap method for converting tags fed for HTML and get
    corresponding React Mapping. Here's an usage example:

    reactCodeMapper = ReactCodeMapper(source_dir, destination_dir, props_map)
    react_map = reactCodeMapper.getReactMap(tag_with_attributes)
    print(react_map)
   * @property {object} CUSTOM_TAG_HANDLERS Stores mapping correspoding to tags which are handled seperately.
   * @property {string} src_dir Source directory for the HTML codebase.
   * @property {string} dest_dir Destination directory for the React codebase.
   * @property {object} props_map Mapping of attrs for HTML to React from props_map.js
   * @property {string[]} add_to_import imports corresponding to variables created during transpilation.
   * @property {string[]} add_variables Stores newly created variables during transpilation.
   * @property {boolean} router_link_imported Saves wether Link tag needs to be imported for current page.
   * @param {string} src_dir Source directory for the HTML codebase.
   * @param {string} dest_dir Destination directory for the React codebase.
   * @param {string} props_map Mapping of attrs for HTML to React from props_map.py
   */

  constructor(src_dir, dest_dir, props_map) {
    this.src_dir = src_dir;
    this.dest_dir = dest_dir;
    this.props_map = props_map;
    this.add_to_import = [];
    this.add_variables = [];
    this.router_link_imported = false;

    this.__A_TAG_HANDLER = "A_TAG_HANDLER";
    this.__IMAGE_TAG_HANDLER = "IMAGE_TAG_HANDLER";
    this.__SCRIPT_TAG_HANDLER = "SCRIPT_TAG_HANDLER";
    this.__STYLE_TAG_HANDLER = "STYLE_TAG_HANDLER";
    this.__LINK_TAG_HANDLER = "LINK_TAG_HANDLER";

    this.CUSTOM_TAG_HANDLERS = {
      a: this.__A_TAG_HANDLER,
      img: this.__IMAGE_TAG_HANDLER,
      script: this.__SCRIPT_TAG_HANDLER,
      style: this.__STYLE_TAG_HANDLER,
      link: this.__LINK_TAG_HANDLER,
    };
  }

  /**
   * Generates safe name for varibale from path to file.
   * @param {string} link Path to file for which varibale is created.
   * @returns {string} Variable name generated from link
   */
  __getSafeName(link) {
    varName = "";
    var regex = /^[0-9a-z]+$/;
    for (ch in link) {
      _ch = link.charAt(ch);
      if (!_ch.match(regex)) {
        _ch = "_";
      }
      varName += _ch;
    }
    return varName;
  }

  /**
   * Generates link information.
    If link is internal corresponding variable name is generated, for
    external link it is returned.
   * @param {string} link Link for filepath or external link.
   * @param {string} filepath_from_src Path to file from src.
   * @param {boolean} no_var To generate import variable or just import file, default is False i.e. generate variable
   * @returns {string} Variable name generated from link or link in external case.
   */
  __getLinkInfo(link, filepath_from_src, no_var = false) {
    if (link) {
      pathToLink = path.join(this.src_dir, filepath_from_src, link);
      pathToIndexLink = path.join(pathToLink, "index.html");
      stats_pathToLink = fs.statSync(pathToLink);
      stats_pathToIndexLink = fs.statSync(pathToIndexLink);
      if (stats_pathToLink || stats_pathToIndexLink) {
        var_ = this.__getSafeName(link);
        if (no_var) {
          this.add_to_import.push("import " + link);
          return undefined;
        } else {
          this.add_to_import.push("import " + var_ + " from " + link);
        }
        this.add_variables.push(var_);
        return "{" + var_ + "}";
      }
    } else {
      return link;
    }
  }

  /**
 * Generates attrs for tags having links to other files.
    If link is internal corresponding variable name is generated, for
    external link it is returned.

 * @param {object} attrs Attributes of tag to be worked upon.
 * @param {string} linkAttr Name of attr that correspond to link of file, example 'src' in case of script tag
 * @param {string} filepath_from_src Path to file from src directory.
 * @param {boolean} no_var To generate import variable or just import file, default is False i.e. generate variable
 * @returns {object} Final dictonary of attributes with link handled     
 */
  __getAttrsWithLink(attrs, linkAttr, filepath_from_src, no_var = false) {
    final_attrs = {};
    for (const [key, value] of Object.entries(attrs)) {
      if (key == linkAttr) {
        link_info = this.__getLinkInfo(value, filepath_from_src, no_var);
        if (link_info == undefined) {
          return;
        }
        final_attrs[linkAttr] = link_info;
      } else {
        final_attrs[key] = value;
      }
    }
    return final_attrs;
  }

  /**
   *Generates attrs for A tag having links to other files. 
      If link is internal that is checked and also link is generated is
      generated, for external link it is returned.

   * @param {object} attrs Attributes of tag to be worked upon.
   * @param {string} filepath_from_src Path to file from src directory.
   * @returns {string[]} Array of final dictonary of attributes with link handled and information about internal link
   */
  __getAttrsForRouterLink(attrs, filepath_from_src) {
    final_attrs = {};
    is_internal = false;
    for (const [key, value] of Object.entries(attrs)) {
      if (key == "href") {
        href_info = value;
        pathRef = path.join(this.src_dir, filepath_from_src, href_info);
        pathRefIndex = path.join(
          this.src_dir,
          filepath_from_src,
          href_info,
          "index.html"
        );
        stats_pathToLink = fs.statSync(pathToLink);
        stats_pathToIndexLink = fs.statSync(pathToIndexLink);
        if (stats_pathToLink || stats_pathToIndexLink) {
          htmlPath = path.normalize(path.join(filepath_from_src, href_info));
          jsPath = htmlPath.split(path.sep).join("/");
          jsPath = jsPath.replace(".html", "");
          if (jsPath == "index") {
            jsPath = "/";
          }
          is_internal = true;
          final_attrs["to"] = jsPath;
        } else {
          final_attrs["href"] = href_info;
        }
      } else {
        final_attrs[key] = value;
      }
    }
    return [final_attrs, is_internal];
  }

  /**
   * Custom tag and attributes handler for parsing attrs from CUSTOM_TAG_HANDLERS
   * @param {object} attrs Attributes for corresponding tag needed to be handled
   * @param {string} tag_handler Tag handler type to be used in mapping
   * @param {string} filepath_from_src Path to file from src directory
   * @returns {object} Final attributes for that tag, if None is returned delete the tag
   */
  __customTagAttrsHandler(attrs, tag_handler, filepath_from_src) {
    final_attrs = {};
    if (tag_handler == this.__A_TAG_HANDLER) {
      res = this.__getAttrsForRouterLink(attrs, filepath_from_src);
      final_attrs = res[0];
      is_internal_link = res[1];
      if (!this.router_link_imported && is_internal_link) {
        this.add_to_import.push('import Link from "react-router-dom";');
        this.router_link_imported = true;
      }
    } else if (tag_handler == this.IMAGE_TAG_HANDLER) {
      final_attrs = this.__getAttrsWithLink(attrs, "src", filepath_from_src);
    } else if (tag_handler == this.__SCRIPT_TAG_HANDLER) {
      if ("src" in attrs) {
        final_attrs = this.__getAttrsWithLink(attrs, "src", filepath_from_src);
      } else {
        return undefined;
      }
    } else if (tag_handler == this.__STYLE_TAG_HANDLER) {
      return undefined;
    } else if (tag_handler == this.__LINK_TAG_HANDLER) {
      if (attrs["rel"] == "stylesheet") {
        final_attrs = this.__getAttrsWithLink(
          attrs,
          "href",
          filepath_from_src,
          (no_var = true)
        );
      }
      return None;
    }
    return final_attrs;
  }

  /**
   * Generates renamed attributes correspoding to React, and removes inline style tags and tags starting with on like onclick etc.
   * @param {object} attrs Attributes in HTML format
   * @returns {object} Attributes in React format
   */
  __getReactAttrs(attrs) {
    final_attrs = {};
    for (const [key, value] of Object.entries(attrs)) {
      if (key == "style") {
        continue;
      }
      if (key.startsWith("on")) {
        continue;
      }
      if (key in this.props_map) {
        useKey = this.props_map[attrKey];
      } else {
        useKey = key;
      }
      final_attrs[useKey] = value;
    }
    return final_attrs;
  }

  /**
   *Wrapper to generate React Map object comprising of all data needed
      to convert HTML to React
   * @param {object} tags HTML attributes extracted using AttributesParser
   * @param {string} filepath_from_src Path to file from src directory
   * @returns {object} Final mapping of tags with imports and varibles for React, if any
                        attribute is None then tag needs to be deleted
   */
  getReactMap(tags, filepath_from_src) {
    final_map = {
      imports: [],
      tags: [],
      variables: [],
    };
    for (const [tag_name] of Object.entries(tags)) {
      attrs = this.__getReactAttrs(tags[tag_name]);
      if (tag_name in this.CUSTOM_TAG_HANDLERS) {
        attrs = this.__customTagAttrsHandler(
          attrs,
          this.CUSTOM_TAG_HANDLERS[tag_name],
          filepath_from_src
        );
      }
      var tag_name_attributes = {};
      tag_name_attributes[tag_name] = attrs;
      final_map["tags"].push(tag_name_attributes);
    }
    final_map["imports"] = this.add_to_import.join("\n");
    final_map["variables"] = this.add_variables;
    return final_map;
  }
}

class Transpiler {
  /**
   * Transpiler responsible for translating HTML code to React
   * @property {string} project_name Name of the project as stored in config
   * @property {string} src_dir Source directory for the HTML codebase.
   * @property {string} dest_dir Destination directory for the React codebase.
   * @property {object} index_routes Stores Routes data corresponding to different pages for index.js
   *
   * @param {object} config_settings project_name, src_dir, dest_dir as dict object stored in config.json
   * @param {object} props_map Mapping of props for HTML to React used during transpilation
   * @param {boolean} verbose Specify the verbosity of the transpiler, deafults to False
   * @param {boolean} create_project Set to True if create project is calling method, deafults to False
   * @throws {RunTimeError}  Error raised if the config_settings point to non existing dirs.
   */

  constructor(
    config_settings,
    props_map,
    verbose = false,
    create_project = false
  ) {
    this.project_name = config_settings["project_name"];
    this.src_dir = config_settings["src_dir"];
    this.dest_dir = config_settings["dest_dir"];
    this.props_map = props_map;
    this.index_routes = {};
    this.parser = "node.html.parser";
    this.verbose = verbose;

    if (create_project) {
      this.src_dir = path.join(".", this.project_name, this.src_dir);
      this.dest_dir = path.join(".", this.project_name, this.dest_dir);
    }

    const npm = new NodeWrapper();

    if (!fs.existsSync(path.join(".", this.src_dir))) {
      throw Error("Source directory doesn't exist at  " + String(this.src_dir));
    }

    if (!fs.existsSync(path.join(".", this.dest_dir))) {
      if (create_project) {
        const project_dir = path.join(".", this.project_name);
        npm.create_react_app(
          (project_name = this.project_name),
          (working_dir = project_dir),
          (rename_to = this.dest_dir)
        );
      } else {
        npm.create_react_app(
          (project_name = this.project_name),
          (rename_to = this.dest_dir)
        );
      }
      // Install NPM packages
      npm.install(
        (package_name = "react-helmet"),
        (working_dir = this.dest_dir)
      );
      npm.install(
        (package_name = "react-router-dom"),
        (working_dir = this.dest_dir)
      );
    }
  }

  /**
   * Replaces the attrs for updated tags comparing original and final attrs.
   * @param {cheerio} $ Cheerio passed by reference
   * @param {string} tag_name Name of tag being worked upon.
   * @param {object} or_attrs Objectconsisting of original attributes of HTML.
   * @param {object} f_attrs Object consisting of final attributes for React.
   */

  __replaceAttrs($, tag_name, or_attrs, f_attrs) {
    if (or_attrs == f_attrs) {
      return;
    }

    const selector = $(this.__getTagWithAttribute(tag_name, or_attrs));
    var htmlTag = selector.first().attr();
    upperAttrs = {};
    lowerAttrs = {};

    if (htmlTag == undefined) {
      for (const [attr] of Object.entries(or_attrs)) {
        upperAttrs[attr] = or_attrs[attr].toUpperCase();
        lowerAttrs[attr] = or_attrs[attr].toLowerCase();
      }
      htmlTag = $(this.__getTagWithAttribute(tag_name, upperAttrs))
        .first()
        .attr();
      if (htmlTag == undefined) {
        htmlTag = $(this.__getTagWithAttribute(tag_name, lowerAttrs))
          .first()
          .attr();
      }
    }
    if (htmlTag != undefined) {
      $(htmlTag.first().attr(f_attrs));
      if (tag_name == "a" && "to" in f_attrs) {
        $((htmlTag.first().get(0).tagName = "Link"));
      }
    }
  }

  __getTagWithAttribute(tag_name, attrs) {
    var tag_with_attr = tag_name;
    for (const [key, value] of Object.entries(attrs)) {
      tag_with_attr = tag_with_attr + "[" + key + '="' + value + '"]';
    }
    return tag_with_attr;
  }

  /**
   * Deletes the tag corresponding to given tag_name and attrs.
    Parameters
   * @param {cheerio} $ cheerio passed by reference
   * @param {string} tag_name Name of tag being worked upon.
   * @param {object} attrs Dictonary consisting of original attributes of HTML.
   */
  __deleteTag($, tag_name, attrs) {
    const selector = $(this.__getTagWithAttribute(tag_name, attrs));
    var htmlTag = selector.first().attr();
    upperAttrs = {};
    lowerAttrs = {};
    if (htmlTag == undefined) {
      for (const [attr] of Object.entries(attrs)) {
        upperAttrs[attr] = attrs[attr].toUpperCase();
        lowerAttrs[attr] = attrs[attr].toLowerCase();
      }
      htmlTag = $(this.__getTagWithAttribute(tag_name, upperAttrs))
        .first()
        .attr();
      if (htmlTag == undefined) {
        htmlTag = $(this.__getTagWithAttribute(tag_name, lowerAttrs))
          .first()
          .attr();
      }
    }
    if (htmlTag != undefined) {
      htmlTag.remove();
    }
  }

  get_tags_with_attributes(tag_arr) {
    let data = [];
    for (let i = 0; i < tag_arr.length; i++) {
      let tag_with_attrs = tag_arr[i].split(" ");
      let len = tag_with_attrs.length;
      tag_with_attrs[0] = tag_with_attrs[0].substring(1);
      tag_with_attrs[len - 1] = tag_with_attrs[len - 1].substring(
        0,
        tag_with_attrs[len - 1].length - 1
      );

      let tag = tag_with_attrs[0];
      let attrs = {};
      for (let j = 1; j < tag_with_attrs.length; j++) {
        let attr_name_value = tag_with_attrs[j].split("=");
        let attr_name = attr_name_value[0];
        let attr_value = attr_name_value[1];
        attrs[attr_name] = attr_value;
      }
      tag_attr = {};
      tag_attr[tag] = attrs;
      data.push(tag_attr);
    }
    return data;
  }
  /**
 * Generates React code from HTML cheerio object.
 * @param {cheerio} $ cheerio passed by reference
 * @param {string} function_name Function name to be used from filename without extension with
            first letter capitalized
 * @param {string} filepath_from_src Path to file from src directory
 * @returns {string} Content for React file.
 */
  __generateReactFileContent($, function_name, filepath_from_src) {
    styleTags = [];
    $("style").each((i, el) => {
      styleTags.push($(el).toString());
    });
    scriptTags = [];
    $("script").each((i, el) => {
      var s = $(el).toString();
      if (!s.includes("src")) {
        scriptTags.push(s);
      }
    });

    let arr = $.html().match(/\<(.*?)\>/g);
    arr.shift();
    let tag_arr = arr.filter((item) => !item.startsWith("</"));
    let tag_with_attributes = this.get_tags_with_attributes(tag_arr);

    let reactCodeMapper = new ReactCodeMapper(
      this.src_dir,
      this.dest_dir,
      this.props_map
    );
    let react_map = reactCodeMapper.getReactMap(
      tag_with_attributes,
      filepath_from_src
    );
    let final_tags = react_map["tags"];
    let react_variables = react_map["variables"];
    for (
      let i = 0;
      i < Math.min(tag_with_attributes.length, final_tags.length);
      i++
    ) {
      let orignal_tag_dict = tag_with_attributes[i];
      let final_tag_dict = final_tags[i];

      let or_tag_name = Object.keys(orignal_tag_dict)[0];
      let or_attrs = orignal_tag_dict[or_tag_name];

      let final_tag_name = Object.keys(final_tag_dict)[0];
      let final_attrs = final_tag_dict[final_tag_name];

      if (or_tag_name == final_tag_name) {
        if (final_attrs == undefined) {
          this.__deleteTag($, or_tag_name, or_attrs);
        } else {
          this.__replaceAttrs($, or_tag_name, or_attrs, final_attrs);
        }
      } else {
        throw "There's an error in processing " + or_tag_name;
      }
    }

    let reactHead = undefined;
    if ($.html().toString().includes("<head>")) {
      head_str = $("head").toString();
      $("head").first().get(0).tagName = "Helmet";
      reactHead = head_str.replace(new RegExp("head", "g"), "Helmet");
    } else {
      if (styleTags.length > 0) {
        $("html").append("<New_Tag></New_Tag>");
        reactHead = $("new_tag").first().get(0).tagName = "Helmet";
      }
    }

    reacthead_start = reactHead.substring(0, reactHead.length - 9);
    if (styleTags.length > 0) {
      for (let i = 0; i < styleTags.length; i++) {
        reacthead_start += styleTags[i];
      }
      reactHead = reacthead_start + "</Helmet>";
    }

    let body_str = "";
    $("body").each((i, el) => {
      body_str += $(el).toString();
    });
    body_str = body_str.substring(6, body_str.length - 7);
    let content_str = "";
    if (reactHead) {
      content_str = reactHead + body_str;
      react_map["imports"] += "import Helmet from 'react-helmet';";
    } else {
      content_str = reactHead + body_str;
    }

    for (let j = 0; j < react_variables.length; j++) {
      variable = react_variables[j];
      content_str = content_str.replace(
        new RegExp('"{' + variable + '}"', "g"),
        "{" + variable + "}"
      );
    }

    let useEffect = "";
    if (scriptTags.length) {
      react_map["imports"] += "import React, { useEffect } from 'react';";
      let scriptContent = "";
      $("script").each((i, el) => {
        let script_str = $(el).toString();
        let script_sub_str = script_str.substring(8, script_str.length - 9);
        scriptContent += script_sub_str;
      });
      useEffect = "useEffect(() => {" + scriptContent + "}, []);";
    } else {
      react_map["imports"] += "import React from 'react';";
      useEffect = "";
    }

    if (styleTags.length > 0) {
      content_str.replace(new RegExp("<style", "g"), "<style>{`");
      content_str.replace(new RegExp("</style>", "g"), "`}</style>");
    }

    let react_function =
      "function " +
      function_name +
      "() {  " +
      useEffect +
      "  return (<>" +
      content_str +
      "</>);}";
    return (
      "\n" +
      react_map["imports"] +
      "\n\n" +
      react_function +
      "\n\n" +
      "export default" +
      function_name
    );
  }

  /**
   * Generates safe name for React compnents from path to file.
   * @param {string} link Path to file for which varibale is created.
   * @returns {string} Variable name generated from link
   */
  __getReactComponentName(link) {
    varName = "";
    var regex = /^[0-9a-z]+$/;
    for (ch in link) {
      _ch = link.charAt(ch);
      if (!_ch.match(regex)) {
        _ch = "_";
      }
      varName += _ch;
    }
    return "REACTONITE" + varName.toUpperCase();
  }

  /**
   * Generates the index.js for React apps entry point, needed to handle
        links to pages
      @throws {RuntimeError} Error raised if the index.js file is not found in dest_dir
   */
  __rebuildIndexJs() {
    pathToIndexJs = path.join(this.dest_dir, "src", "index.js");
    if (!fs.statSync(pathToIndexJs)) {
      throw new Error(
        "Looks like you are missing index.js file in \
                React directory! It seems to be an NPM/React issue rather."
      );
    }
    fs.open(path, "w", function (err, fd) {
      if (err) {
        throw "Error opening the file" + err;
      }
      file_content = this.__generateIndexJsContent();
      fs.write(fd, file_content, 0, file_content.length, null, function (err) {
        if (err) {
          throw "Error writing file: " + err;
        }
      });
    });
    NodeWrapper().prettify((path = pathToIndexJs));
  }

  /**
 * Adds links to this.index_routes to be used in index.js generation

 * @param {string} filePathFromSrc Path to the folder where file is in dest_dir folder from src
 * @param {string} filenameNoExt Filename with no extension
 */
  __addRoutesToIndexLinkArray(filePathFromSrc, filenameNoExt) {
    if (filenameNoExt == "index") {
      htmlPath = path.normalize(filePathFromSrc);
      jsPath = htmlPath.split(path.sep).join("./");
      this.index_routes[jsPath] = "./" + jsPath + "/index";
    } else {
      htmlPath = path.normalize(path.join(filePathFromSrc, filenameNoExt));
      jsPath = htmlPath.split(path.sep).join("./");
      this.index_routes[jsPath] = "./" + jsPath;
    }
  }

  /**
   * Generates content for index.js file in React codebase with handled routes
   * @returns {string} Content for index.js file in React codebase
   */
  __generateIndexJsContent() {
    var router =
      'import {\n BrowserRouter as Router,\n Switch, \nRoute \n} from "react-router-dom";';
    var imports = [];
    var routes = [];

    for (const [key, value] of Object.entries(this.index_routes)) {
      var componentName = this.__getReactComponentName(value);
      var importReact = "import " + componentName + ' from "' + value + '";';
      imports.push(importReact);
      var routeReact =
        '<Route path="/' + key + '">\n<' + componentName + "/>\n</Route>";
      routes.push(routeReact);
    }

    imports = imports.join("/");
    routes = routes.join("/");

    return (
      'import React from "react";\n\
        import ReactDOM from "react-dom";\n\
        import * as serviceWorkerRegistration from ./serviceWorkerRegistration";\n\
        import reportWebVitals from "./reportWebVitals";\n' +
      router +
      'import App from "./App";\n' +
      imports +
      "ReactDOM.render(\n\
        <Router>\n\
            <Switch>\n" +
      routes +
      '<Route path="/">\n\
                <App />\n\
            </Route>\n\
            </Switch>\n\
        </Router>,\n\
        document.getElementById("root")\n\
        );\n' +
      "// If you dont want your app to work offline, you can change\n\
        // register() to unregister() below. Note this comes with some\n\
        // pitfalls. Learn more about service workers: https://cra.link/PWA\n\
        serviceWorkerRegistration.register();\n\
        // If you want to start measuring performance in your app, pass a\n\
        // function to log results (for example: reportWebVitals(console.log))\n\
        // or send to analytics endpoint. Learn more: https://bit.ly/CRA-vitals\n\
        reportWebVitals();\n"
    );
  }

  /**
   * Transpiles the source HTML file given at the given filepath
      to a React code, which is then copied over to the React build
      directory, if not HTML file then get's copied directly.

   * @param {string} filepath Path to the source HTML file which is to be transpiled
   * @throws {RuntimeError} Raised if the source html file is not found
   */
  transpileFile(filepath) {
    components = filepath.split(path.sep);
    index = components.indexOf("src");
    file_name_with_extension = components.pop();
    file_name_split = file_name_with_extension.split(".");
    filenameWithNoExtension = file_name_split[0];
    extension = file_name_split[1];
    filePathFromSrc = components.slice(index + 1).join("/");

    if (extension != "html") {
      var dest_filepath = path.join(
        this.dest_dir,
        "src",
        filePathFromSrc,
        file_name_with_extension
      );
      if (this.verbose) {
        console.log(
          "Copying file " + String(filepath) + " -> " + String(dest_filepath)
        );
      }
      try {
        fs.mkdirSync(path.dirname(dest_filepath), true);
      } catch {
        console.log("Error making a new directory");
      }
      fse.copyFileSync(filepath, dest_filepath);
      return;
    }

    var stats = fs.statSync(filepath);
    if (stats || !stats.isFile()) {
      throw filepath + " file not found";
    }

    var is_entry_point = false;
    var entry_point_html = path.join(this.src_dir, "index.html");

    if (entry_point_html == filepath) {
      is_entry_point = true;
      filenameWithNoExtension = "App";
    }

    file_name_with_extension = filenameWithNoExtension + ".js";
    stats = fs.statSync(path.join(this.dest_dir, "src"));
    if (stats || !stats.isDirectory()) {
      throw (
        "Looks like your React project didn't get \n\
      created please check your " +
        this.dest_dir +
        " for a src \n\
      folder"
      );
    }

    dest_filepath = path.join(
      this.dest_dir,
      "src",
      filePathFromSrc,
      file_name_with_extension
    );
    if (this.verbose) {
      console.log(
        "Transpiling file " + String(filepath) + " -> " + String(dest_filepath)
      );
    }

    var htmlString = fs.readFileSync(filepath);
    const $ = cheerio.load(htmlString);

    // removing comments
    $("html")
      .contents()
      .filter(function () {
        return this.type === "comment";
      })
      .remove();

    try {
      fs.mkdirSync(path.dirname(dest_filepath), true);
    } catch {
      console.log("Error making a new directory");
    }
    filenameWithNoExtension =
      filenameWithNoExtension.charAt(0).toUpperCase() +
      filenameWithNoExtension.substring(1).toLowerCase();
    var file_content = this.__generateReactFileContent(
      $,
      filenameWithNoExtension,
      filePathFromSrc
    );
    try {
      var fd = fs.openSync(dest_filepath, "w");
      try {
        fs.close(fs.write(fd, file_content));
      } catch {
        throw new Error("Error writing file");
      }
    } catch {
      throw new Error("File can not be reached at ", path);
    }

    NodeWrapper().prettify((path = dest_filepath));
    if (!is_entry_point) {
      this.__addRoutesToIndexLinkArray(
        filePathFromSrc,
        filenameWithNoExtension
      );
    }
  }

  /**
   * Runs initial checks like ensuring the source
     directories exist, and the source file is present.
     After that, copies non html files and transpiles the source.

   * @param {boolean} copy_static bool, optional
            Will copy non .html files if True, only .html files will be
            transpiled if False, default True
   * @throws {RuntimeError} Error raised when source html file is missing. 
   */
  transpile_project(copy_static = true) {
    var entry_point_html = path.join(this.src_dir, "index.html");
    var stats = fs.statSync(entry_point_html);
    if (stats || !stats.isFile()) {
      throw "Entry point file doesn't exist at " + String(entry_point_html);
    }
    if (this.verbose) {
      console.log("Transpiling files...");
    }
    var filepaths = glob.sync(path.join("src", "**/**"));
    for (var i = 0; i < filepaths.length; i++) {
      var file = filepaths[i];
      if (fs.statSync(file).isFile()) {
        var components = file.split(path.sep);
        var file_name_with_extension = components.pop();
        var file_name_split = file_name_with_extension.split(".");
        var extension = file_name_split[1];
        if (extension == "html" || copy_static) {
          this.transpileFile(file);
        }
      }
    }
    this.__rebuildIndexJs();
  }
}
