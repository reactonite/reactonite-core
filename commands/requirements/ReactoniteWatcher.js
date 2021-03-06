const path = require("path");
const fs = require("fs");
const CONSTANTS = require("./Constants");
const Transpiler = require("./Transpiler");
const hound = require("hound");

class ReactoniteWatcher {
  /**
   * A file/directory watcher to report events incase they are modified/created/deleted.
   *@property {string} src_dir Path of the source directory to watch and report for events.
   *@property {string} dest_dir Path of the destination direectory to write transpiled code.
   *@property {object} config_settings Path to src_dir and dest_dir as dict object, stored in config.json
   */

  constructor(
    config_settings,
    patterns = "*",
    ignore_patterns = "",
    ignore_directories = false,
    case_sensitive = true,
    recursive = true
  ) {
    this.src_dir = config_settings["src_dir"];
    this.dest_dir = config_settings["dest_dir"];
    this.config_settings = config_settings;

    if (!fs.existsSync(path.join(".", this.src_dir))) {
      throw new Error(
        "Source directory doesn't exist at " + String(this.src_dir)
      );
    }
    if (!fs.existsSync(path.join(".", this.dest_dir))) {
      throw new Error(
        "Destination directory doesn't exist at " + String(this.dest_dir)
      );
    }
    this.patterns = patterns;
    this.ignore_patterns = ignore_patterns;
    this.ignore_directories = ignore_directories;
    this.case_sensitive = true;
    this.recursive = recursive;
    this.transpiler = new Transpiler(
      config_settings,
      (props_map = CONSTANTS.PROPS_MAP),
      (verbose = true)
    );
  }

  /**
   * Runs the hound service on the given path. Handles various events to different functions as per the requirement
   */
  start() {
    watcher = hound.watch(this.src_dir);
    watcher.on("create", __on_created(file, stats));
    watcher.on("change", __on_modified(file, stats));
    watcher.on("delete", __on_deleted(file, stats));

    print("Started watching for changes on path" + this.src_dir);
  }

  /**
   *This event is called when a file/directory is created.
   * @param {object} file File/Directory
   * @param {object} stats An event object containing necessary details about it.
   */
  __on_created(file, stats) {
    console.log(file + " has been created!");
    var stats = fs.statSync(file);
    if (stats.isDirectory()) {
      return;
    } else if (stats.isFile() || stats.isSymbolicLink()) {
      try {
        this.transpiler.transpile_project();
      } catch {
        console.log("transpile project failed");
      }
    }
  }

  /**
   * This event is called when a file/directory is deleted.
   * @param {object} file File/Directory
   * @param {object} stats An event object containing necessary details about it
   */
  __on_deleted(file, stats) {
    console.log("Deleted" + file + "!");
    try {
      this.transpiler.transpile_project((copy_static = false));
    } catch {
      console.log("transpile project failed");
    }
    this.__delete_file(file);
  }

  /**
   * This event is called when a file/directory is modified.
   * @param {*} file File/Directory
   * @param {*} stats An event object containing necessary details about the it.
   */
  __on_modified(file, stats) {
    console.log(file + "has been modified");
    var stats = fs.statSync(file);
    if (stats.isDirectory()) {
      return;
    } else if (stats.isFile() || stats.isSymbolicLink()) {
      this.__new_file(file);
    }
  }

  __new_file(filepath) {
    try {
      this.transpiler.transpileFile(filepath);
    } catch {
      console.log("transpiler failed");
    }
  }

  __delete_file(filepath) {
    components = filepath.split(path.sep);
    index = components.indexOf("src");
    file_name_with_extension = components.pop();
    file_name_split = file_name_with_extension.split(".");
    filenameWithNoExtension = file_name_split[0];
    extension = file_name_split[1];
    filePathFromSrc = components.slice(index + 1).join("/");

    if (extension == "html") {
      file_name_with_extension = filenameWithNoExtension + ".js";
    }
    dest_filepath = path.join(
      this.dest_dir,
      "src",
      filePathFromSrc,
      file_name_with_extension
    );
    print("removing", dest_filepath);
    try {
      this.__remove(dest_filepath);
    } catch {
      console.log("could not remove the file");
    }
    return;
  }

  __remove(path) {
    var stats = fs.statSync(path);
    if (stats.isFile() || stats.isSymbolicLink()) {
      fs.unlinkSync(path);
    } else if (stats.isDirectory()) {
      fs.rmdirSync(path, { recursive: true });
    } else {
      throw Error("file" + path + " is not a file or dir.");
    }
  }
}
