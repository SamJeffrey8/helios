//@ts-check
// Tokenization

import {
    Source,
    assert,
    assertDefined,
    hexToBytes
} from "./utils.js";

/**
 * @typedef {import("./tokens.js").CodeMap} CodeMap
 */

import {
    BoolLiteral,
    ByteArrayLiteral,
    Group,
    IntLiteral,
    StringLiteral,
    Site,
    SymbolToken,
    Token,
    Word
} from "./tokens.js";

export class Tokenizer {
	#src;
	#pos;

	/**
	 * Tokens are accumulated in '#ts'
	 * @type {Token[]} 
	 */
	#ts;
	#codeMap;
	#codeMapPos;

	/**
	 * @param {Source} src 
	 * @param {?CodeMap} codeMap 
	 */
	constructor(src, codeMap = null) {
		assert(src instanceof Source);

		this.#src = src;
		this.#pos = 0;
		this.#ts = []; // reset to empty to list at start of tokenize()
		this.#codeMap = codeMap; // can be a list of pairs [pos, site in another source]
		this.#codeMapPos = 0; // not used if codeMap === null
	}

	incrPos() {
		this.#pos += 1;
	}

	decrPos() {
		this.#pos -= 1;
		assert(this.#pos >= 0);
	}

	get currentSite() {
		return new Site(this.#src, this.#pos);
	}

	/**
	 * @param {Token} t 
	 */
	pushToken(t) {
		this.#ts.push(t);

		if (this.#codeMap !== null && this.#codeMapPos < this.#codeMap.length) {
			let pair = (this.#codeMap[this.#codeMapPos]);

			if (pair[0] == t.site.pos) {
				t.site.setCodeMapSite(pair[1]);
				this.#codeMapPos += 1;
			}
		}
	}

	/**
	 * Reads a single char from the source and advances #pos by one
	 * @returns {string}
	 */
	readChar() {
		assert(this.#pos >= 0);

		let c;
		if (this.#pos < this.#src.length) {
			c = this.#src.getChar(this.#pos);
		} else {
			c = '\0';
		}

		this.incrPos();

		return c;
	}

	/**
	 * Decreases #pos by one
	 */
	unreadChar() {
		this.decrPos();
	}

	/**
	 * Start reading precisely one token
	 * @param {Site} site 
	 * @param {string} c 
	 */
	readToken(site, c) {
		if (c == '_' || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) {
			this.readWord(site, c);
		} else if (c == '/') {
			this.readMaybeComment(site);
		} else if (c == '0') {
			this.readSpecialInteger(site);
		} else if (c >= '1' && c <= '9') {
			this.readDecimalInteger(site, c);
		} else if (c == '#') {
			this.readByteArray(site);
		} else if (c == '"') {
			this.readString(site);
		} else if (c == '?' || c == '!' || c == '%' || c == '&' || (c >= '(' && c <= '.') || (c >= ':' && c <= '>') || c == '[' || c == ']' || (c >= '{' && c <= '}')) {
			this.readSymbol(site, c);
		} else if (!(c == ' ' || c == '\n' || c == '\t' || c == '\r')) {
			throw site.syntaxError(`invalid source character '${c}' (utf-8 not yet supported outside string literals)`);
		}
	}

	/**
	 * Tokenize the complete source.
	 * Nests groups before returning a list of tokens
	 * @returns {Token[]}
	 */
	tokenize() {
		// reset #ts
		this.#ts = [];

		let site = this.currentSite;
		let c = this.readChar();

		while (c != '\0') {
			this.readToken(site, c);

			site = this.currentSite;
			c = this.readChar();
		}

		return Tokenizer.nestGroups(this.#ts);
	}

	/** 
	 * Returns a generator
	 * Use gen.next().value to access to the next Token
	 * Doesn't perform any grouping
	 * Used for quickly parsing the ScriptPurpose header of a script
	 * @returns {Generator<Token>}
	 */
	*streamTokens() {
		this.#ts = [];

		let site = this.currentSite;
		let c = this.readChar();

		while (c != '\0') {
			this.readToken(site, c);

			let t = this.#ts.shift();
			while (t != undefined) {
				yield t;
				t = this.#ts.shift();
			}

			site = this.currentSite;
			c = this.readChar();
		}

		assert(this.#ts.length == 0);
	}

	/**
	 * Reads one word token.
	 * Immediately turns "true" or "false" into a BoolLiteral instead of keeping it as Word
	 * @param {Site} site
	 * @param {string} c0 - first character 
	 */
	readWord(site, c0) {
		let chars = [];

		let c = c0;
		while (c != '\0') {
			if (c == '_' || (c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) {
				chars.push(c);
				c = this.readChar();
			} else {
				this.unreadChar();
				break;
			}
		}

		let value = chars.join('');

		if (value == "true" || value == "false") {
			this.pushToken(new BoolLiteral(site, value == "true"));
		} else {
			this.pushToken(new Word(site, value));
		}
	}

	/**
	 * Reads and discards a comment if current '/' char is followed by '/' or '*'.
	 * Otherwise pushes Symbol('/') onto #ts
	 * @param {Site} site 
	 */
	// comments are discarded
	readMaybeComment(site) {
		let c = this.readChar();

		if (c == '\0') {
			this.pushToken(new SymbolToken(site, '/'));
		} else if (c == '/') {
			this.readSingleLineComment();
		} else if (c == '*') {
			this.readMultiLineComment(site);
		} else {
			this.pushToken(new SymbolToken(site, '/'));
			this.unreadChar();
		}
	}

	/**
	 * Reads and discards a single line comment (from '//' to end-of-line)
	 */
	readSingleLineComment() {
		let c = this.readChar();

		while (c != '\n' && c != '\0') {
			c = this.readChar();
		}
	}

	/**
	 * Reads and discards a multi-line comment (from '/' '*' to '*' '/')
	 * @param {Site} site 
	 */
	readMultiLineComment(site) {
		let prev = '';
		let c = this.readChar();

		while (true) {
			prev = c;
			c = this.readChar();

			if (c == '/' && prev == '*') {
				break;
			} else if (c == '\0') {
				throw site.syntaxError("unterminated multiline comment");
			}
		}
	}

	/**
	 * REads a literal integer
	 * @param {Site} site 
	 */
	readSpecialInteger(site) {
		let c = this.readChar();

		if (c == '\0') {
			this.pushToken(new IntLiteral(site, 0n));
		} else if (c == 'b') {
			this.readBinaryInteger(site);
		} else if (c == 'o') {
			this.readOctalInteger(site);
		} else if (c == 'x') {
			this.readHexInteger(site);
		} else if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) {
			throw site.syntaxError(`bad literal integer type 0${c}`);
		} else if (c >= '0' && c <= '9') {
			this.readDecimalInteger(site, c);
		} else {
			this.pushToken(new IntLiteral(site, 0n));
			this.unreadChar();
		}
	}

	/**
	 * @param {Site} site 
	 */
	readBinaryInteger(site) {
		this.readRadixInteger(site, "0b", c => (c == '0' || c == '1'));
	}

	/**
	 * @param {Site} site 
	 */
	readOctalInteger(site) {
		this.readRadixInteger(site, "0o", c => (c >= '0' && c <= '7'));
	}

	/**
	 * @param {Site} site 
	 */
	readHexInteger(site) {
		this.readRadixInteger(site, "0x",
			c => ((c >= '0' && c <= '9') || (c >= 'a' || c <= 'f')));
	}

	/**
	 * @param {Site} site 
	 * @param {string} c0 - first character
	 */
	readDecimalInteger(site, c0) {
		let chars = [];

		let c = c0;
		while (c != '\0') {
			if (c >= '0' && c <= '9') {
				chars.push(c);
			} else if ((c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) {
				throw site.syntaxError("invalid syntax for decimal integer literal");
			} else {
				this.unreadChar();
				break;
			}

			c = this.readChar();
		}

		this.pushToken(new IntLiteral(site, BigInt(chars.join(''))));
	}

	/**
	 * @param {Site} site 
	 * @param {string} prefix 
	 * @param {(c: string) => boolean} valid - checks if character is valid as part of the radix
	 */
	readRadixInteger(site, prefix, valid) {
		let c = this.readChar();

		let chars = [];

		if (!(valid(c))) {
			throw site.syntaxError(`expected at least one char for ${prefix} integer literal`);
		}

		while (c != '\0') {
			if (valid(c)) {
				chars.push(c);
			} else if ((c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')) {
				throw site.syntaxError(`invalid syntax for ${prefix} integer literal`);
			} else {
				this.unreadChar();
				break;
			}

			c = this.readChar();
		}

		this.pushToken(new IntLiteral(site, BigInt(prefix + chars.join(''))));
	}

	/**
	 * Reads literal hexadecimal representation of ByteArray
	 * @param {Site} site 
	 */
	readByteArray(site) {
		let c = this.readChar();

		let chars = [];

		// case doesn't matter
		while ((c >= 'a' && c <= 'f') || (c >= '0' && c <= '9')) {
			chars.push(c);
			c = this.readChar();
		}

		// empty byteArray is allowed (eg. for Ada mintingPolicyHash)

		// last char is the one that made the while loop break, so should be unread
		this.unreadChar();

		let bytes = hexToBytes(chars.join(''));

		this.pushToken(new ByteArrayLiteral(site, bytes));
	}

	/**
	 * Reads literal string delimited by double quotes.
	 * Allows for three escape character: '\\', '\n' and '\t'
	 * @param {Site} site 
	 */
	readString(site) {
		let c = this.readChar();

		let chars = [];

		let escaping = false;
		/** @type {?Site} */
		let escapeSite = null; // for escape syntax errors

		while (!(!escaping && c == '"')) {
			if (c == '\0') {
				throw site.syntaxError("unmatched '\"'");
			}

			if (escaping) {
				if (c == 'n') {
					chars.push('\n');
				} else if (c == 't') {
					chars.push('\t');
				} else if (c == '\\') {
					chars.push('\\');
				} else if (c == '"') {
					chars.push(c);
				} else if (escapeSite !== null) {
					throw escapeSite.syntaxError(`invalid escape sequence ${c}`)
				} else {
					throw new Error("escape site should be non-null");
				}

				escaping = false;
			} else {
				if (c == '\\') {
					escapeSite = this.currentSite;
					escaping = true;
				} else {
					chars.push(c);
				}
			}

			c = this.readChar();
		}

		this.pushToken(new StringLiteral(site, chars.join('')));
	}

	/**
	 * Reads single or double character symbols
	 * @param {Site} site 
	 * @param {string} c0 - first character
	 */
	readSymbol(site, c0) {
		let chars = [c0];

		/** @type {(second: string) => boolean} */
		let parseSecondChar = (second) => {
			let d = this.readChar();

			if (d == second) {
				chars.push(d);
				return true;
			} else {
				this.unreadChar();
				return false;
			}
		}

		if (c0 == '|') {
			parseSecondChar('|');
		} else if (c0 == '&') {
			parseSecondChar('&');
		} else if (c0 == '=') {
			if (!parseSecondChar('=')) {
				parseSecondChar('>');
			}
		} else if (c0 == '!' || c0 == '<' || c0 == '>') { // could be !=, ==, <= or >=
			parseSecondChar('=');
		} else if (c0 == ':') {
			parseSecondChar(':');
		} else if (c0 == '-') {
			parseSecondChar('>');
		}

		this.pushToken(new SymbolToken(site, chars.join('')));
	}

	/**
	 * Separates tokens in fields (separted by commas)
	 * @param {Token[]} ts 
	 * @returns {Group}
	 */
	static buildGroup(ts) {
		let tOpen = ts.shift();
		if (tOpen === undefined) {
			throw new Error("unexpected");
		} else {
			let open = tOpen.assertSymbol();

			let stack = [open]; // stack of symbols
			let curField = [];
			let fields = [];

			/** @type {?SymbolToken} */
			let firstComma = null;

			/** @type {?SymbolToken} */
			let lastComma = null;

			/** @type {?Site} */
			let endSite = null;

			while (stack.length > 0 && ts.length > 0) {
				let t = assertDefined(ts.shift());
				let prev = stack.pop();
				endSite = t.site;

				if (t != undefined && prev != undefined) {
					if (!t.isSymbol(Group.matchSymbol(prev))) {
						stack.push(prev);

						if (Group.isCloseSymbol(t)) {
							throw t.syntaxError(`unmatched '${t.assertSymbol().value}'`);
						} else if (Group.isOpenSymbol(t)) {
							stack.push(t.assertSymbol());
							curField.push(t);
						} else if (t.isSymbol(",") && stack.length == 1) {
							if (firstComma === null) {
								firstComma = t.assertSymbol();
							}

							lastComma = t.assertSymbol();
							if (curField.length == 0) {
								throw t.syntaxError("empty field");
							} else {
								fields.push(curField);
								curField = [];
							}
						} else {
							curField.push(t);
						}
					} else if (stack.length > 0) {
						curField.push(t);
					}
				} else {
					throw new Error("unexpected");
				}
			}

			let last = stack.pop();
			if (last != undefined) {
				throw last.syntaxError(`EOF while matching '${last.value}'`);
			}

			if (curField.length > 0) {
				// add removing field
				fields.push(curField);
			} else if (lastComma !== null) {
				throw lastComma.syntaxError(`trailing comma`);
			}

			fields = fields.map(f => Tokenizer.nestGroups(f));

			let site = tOpen.site;
			site.setEndSite(endSite);

			return new Group(site, open.value, fields, firstComma);
		}
	}

	/**
	 * Match group open with group close symbols in order to form groups.
	 * This is recursively applied to nested groups.
	 * @param {Token[]} ts 
	 * @returns {Token[]}
	 */
	static nestGroups(ts) {
		let res = [];

		let t = ts.shift();
		while (t != undefined) {
			if (Group.isOpenSymbol(t)) {
				ts.unshift(t);

				res.push(Tokenizer.buildGroup(ts));
			} else if (Group.isCloseSymbol(t)) {
				throw t.syntaxError(`unmatched '${t.assertSymbol().value}'`);
			} else {
				res.push(t);
			}

			t = ts.shift();
		}

		return res;
	}
}

/**
 * Tokenizes a string (wrapped in Source)
 * @package
 * @param {Source} src 
 * @returns {Token[]}
 */
export function tokenize(src) {
	let tokenizer = new Tokenizer(src);

	return tokenizer.tokenize();
}

/**
 * Tokenizes an IR string with a codemap to the original source
 * @package
 * @param {string} rawSrc 
 * @param {CodeMap} codeMap 
 * @returns {Token[]}
 */
export function tokenizeIR(rawSrc, codeMap) {
	let src = new Source(rawSrc);

	// the Tokenizer for Helios can simply be reused for the IR
	let tokenizer = new Tokenizer(src, codeMap);

	return tokenizer.tokenize();
}