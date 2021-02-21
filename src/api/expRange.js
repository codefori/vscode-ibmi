module.exports = class expRange {

    constructor(low, high)
    {
      this._low = low;
      this._high = high;
      this.file = undefined;
    }

    low(value) {
      if (value !== undefined) 
        this._low = value;

      return this._low;
    }

    high(value) {
      if (value !== undefined) 
        this._high = value;

      return this._high;
    }

    afterRange(num)
    {
      return (num >= this._low);
    }

    startsAfterLow(num) {
      return (number => this._low && number <= this._high);
    }

    inFileRange(number) 
    {
      const res = (number >= this._low && number <= this._high);
      return res;
    }

    getVal()
    {
      return (this._high - this._low) + 1;
    }
}